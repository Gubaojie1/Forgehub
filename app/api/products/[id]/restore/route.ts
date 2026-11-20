import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireAccess(request, "admin");
    const { id } = await context.params;
    const db = getD1();
    const product = await db.prepare("SELECT code, name, archived_at FROM products WHERE id = ?").bind(id).first<{ code: string; name: string; archived_at: string | null }>();
    if (!product) return Response.json({ error: "产品不存在" }, { status: 404 });
    if (!product.archived_at) return Response.json({ error: "该产品未归档，无需恢复" }, { status: 409 });
    await db.prepare("UPDATE products SET status = COALESCE(archived_status, '研发'), archived_at = NULL, archived_by = NULL, archived_status = NULL WHERE id = ?").bind(id).run();
    await writeAudit(access.email, "product.restore", "product", id, `恢复归档产品 ${product.code} · ${product.name}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "恢复产品失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
