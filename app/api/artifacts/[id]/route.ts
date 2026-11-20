import { AccessError, getBucket, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getD1();
    const artifact = await db.prepare("SELECT id, release_id, product_id, name, object_key FROM artifacts WHERE id = ?").bind(id).first<{ id: string; release_id: string; product_id: string; name: string; object_key: string }>();
    if (!artifact) return Response.json({ error: "固件文件不存在" }, { status: 404 });
    const access = await requireAccess(request, "developer", artifact.product_id);
    const release = await db.prepare("SELECT status FROM releases WHERE id = ?").bind(artifact.release_id).first<{ status: string }>();
    if (!release || release.status !== "草稿") return Response.json({ error: "仅草稿版本可以移除文件；测试中的版本请先退回草稿" }, { status: 409 });
    await getBucket().delete(artifact.object_key);
    await db.batch([
      db.prepare("DELETE FROM artifacts WHERE id = ?").bind(artifact.id),
      db.prepare("UPDATE releases SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), artifact.release_id),
    ]);
    await writeAudit(access.email, "artifact.delete", "release", artifact.release_id, `移除草稿文件 ${artifact.name}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "移除文件失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
