import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const db = getD1();
    const existing = await db.prepare("SELECT product_id, status FROM protocols WHERE id = ?").bind(id).first<{ product_id: string; status: string }>();
    if (!existing) return Response.json({ error: "协议不存在" }, { status: 404 });
    const access = await requireAccess(request, existing.status === "已发布" ? "admin" : "developer", existing.product_id);
    const body = await request.json() as { name?: string; version?: string; interfaceType?: string; status?: string; description?: string };
    const name = body.name?.trim(); const version = body.version?.trim();
    if (!name || !version) return Response.json({ error: "协议名称和版本不能为空" }, { status: 400 });
    if (body.status === "已发布" && !access.isAdmin) throw new AccessError("只有管理员可以发布协议");
    await db.prepare("UPDATE protocols SET name = ?, version = ?, interface_type = ?, status = ?, description = ?, updated_at = ? WHERE id = ?").bind(name, version, body.interfaceType?.trim() || "未指定", body.status || existing.status, body.description?.trim() || "", new Date().toISOString().slice(0, 10), id).run();
    await writeAudit(access.email, "protocol.update", "protocol", id, `更新协议 ${name} ${version}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "协议更新失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const db = getD1();
    const protocol = await db.prepare("SELECT product_id, name, version, status FROM protocols WHERE id = ?").bind(id).first<{ product_id: string; name: string; version: string; status: string }>();
    if (!protocol) return Response.json({ error: "协议不存在" }, { status: 404 });
    const access = await requireAccess(request, protocol.status === "已发布" ? "admin" : "developer", protocol.product_id);
    const files = await db.prepare("SELECT COUNT(*) AS total FROM protocol_files WHERE protocol_id = ?").bind(id).first<{ total: number }>();
    if ((files?.total ?? 0) > 0) return Response.json({ error: "该协议已有附件，不能直接删除" }, { status: 409 });
    await db.prepare("DELETE FROM protocols WHERE id = ?").bind(id).run();
    await writeAudit(access.email, "protocol.delete", "protocol", id, `删除空协议 ${protocol.name} ${protocol.version}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "协议删除失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
