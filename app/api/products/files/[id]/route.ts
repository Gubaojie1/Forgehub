import { AccessError, getBucket, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getD1();
    const file = await db.prepare("SELECT id, product_id, category, file_name, object_key, active FROM product_files WHERE id = ?").bind(id).first<{ id: string; product_id: string; category: string; file_name: string; object_key: string; active: number }>();
    if (!file) return Response.json({ error: "产品资料不存在" }, { status: 404 });
    const access = await requireAccess(request, "admin", file.product_id);
    const replacement = Number(file.active) === 1
      ? await db.prepare("SELECT id FROM product_files WHERE product_id = ? AND category = ? AND id <> ? ORDER BY created_at DESC LIMIT 1").bind(file.product_id, file.category, file.id).first<{ id: string }>()
      : null;
    await getBucket().delete(file.object_key);
    await db.batch([
      db.prepare("DELETE FROM product_files WHERE id = ?").bind(file.id),
      ...(replacement ? [db.prepare("UPDATE product_files SET active = 1 WHERE id = ?").bind(replacement.id)] : []),
    ]);
    await writeAudit(access.email, "product.file.delete", "product", file.product_id, `删除产品资料 ${file.file_name}${replacement ? "，已恢复上一版本为当前版本" : ""}`);
    return Response.json({ restoredPrevious: Boolean(replacement) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除产品资料失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
