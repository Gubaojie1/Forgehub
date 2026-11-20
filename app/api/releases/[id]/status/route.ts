import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const body = await request.json() as { status?: string };
    const db = getD1(); const release = await db.prepare("SELECT product_id, version, status FROM releases WHERE id = ?").bind(id).first<{ product_id: string; version: string; status: string }>();
    if (!release) return Response.json({ error: "固件版本不存在" }, { status: 404 });
    const access = await requireAccess(request, "developer", release.product_id);
    const allowed: Record<string, string[]> = { "草稿": ["开发自测"], "开发自测": ["草稿"] };
    if (!body.status || !allowed[release.status]?.includes(body.status)) return Response.json({ error: `不能从“${release.status}”切换到“${body.status ?? "未知"}”` }, { status: 409 });
    if (body.status === "开发自测") {
      const gate = await db.prepare("SELECT (SELECT COUNT(*) FROM release_hardware_bindings b JOIN hardware_variants h ON h.id = b.hardware_variant_id WHERE b.release_id = ?) AS hardware, (SELECT release_notes FROM releases WHERE id = ?) AS notes").bind(id, id).first<{ hardware: number; notes: string }>();
      if ((gate?.hardware ?? 0) === 0 || !gate?.notes?.trim()) return Response.json({ error: "进入测试前必须绑定硬件并填写更新说明" }, { status: 409 });
    }
    await db.prepare("UPDATE releases SET status = ? WHERE id = ?").bind(body.status, id).run();
    await writeAudit(access.email, "release.status", "release", id, `${release.version}：${release.status} → ${body.status}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "状态更新失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
