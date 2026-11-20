import { AccessError, getBucket, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const db = getD1();
    const existing = await db.prepare("SELECT id FROM tools WHERE id = ?").bind(id).first<{ id: string }>();
    if (!existing) return Response.json({ error: "工具不存在" }, { status: 404 });
    const access = await requireAccess(request, "developer");
    const body = await request.json() as { productIds?: string[]; name?: string; version?: string; platform?: string; status?: string; description?: string };
    const productIds = Array.from(new Set((body.productIds ?? []).map((item) => item.trim()).filter(Boolean)));
    if (!access.isAdmin && productIds.some((productId) => !access.productIds.includes(productId) && !access.ownedProductIds.includes(productId))) throw new AccessError("只能关联您有权限的产品");
    const name = body.name?.trim(); const version = body.version?.trim();
    if (!name || !version) return Response.json({ error: "工具名称和版本不能为空" }, { status: 400 });
    await db.batch([
      db.prepare("UPDATE tools SET product_id = NULL, name = ?, version = ?, platform = ?, status = ?, description = ?, updated_at = ? WHERE id = ?").bind(name, version, body.platform?.trim() || "跨平台", body.status || "维护中", body.description?.trim() || "", new Date().toISOString().slice(0, 10), id),
      db.prepare("DELETE FROM tool_product_bindings WHERE tool_id = ?").bind(id),
      ...productIds.map((productId) => db.prepare("INSERT OR IGNORE INTO tool_product_bindings (tool_id, product_id) VALUES (?, ?)").bind(id, productId)),
    ]);
    await writeAudit(access.email, "tool.update", "tool", id, `更新工具 ${name} ${version}，关联 ${productIds.length} 个产品`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "工具更新失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const db = getD1();
    const tool = await db.prepare("SELECT name, version FROM tools WHERE id = ?").bind(id).first<{ name: string; version: string }>();
    if (!tool) return Response.json({ error: "工具不存在" }, { status: 404 });
    const access = await requireAccess(request, "admin");
    const attachments = await db.prepare("SELECT id, object_key FROM tool_files WHERE tool_id = ?").bind(id).all<{ id: string; object_key: string }>();
    const force = new URL(request.url).searchParams.get("force") === "true";
    if (attachments.results.length > 0 && !force) return Response.json({ error: "该工具已有附件，确认后可连同附件一起删除", fileCount: attachments.results.length, canForceDelete: true }, { status: 409 });
    if (attachments.results.length > 0) await Promise.all(attachments.results.map((file) => getBucket().delete(file.object_key)));
    await db.batch([
      ...(attachments.results.length > 0 ? [db.prepare("DELETE FROM tool_files WHERE tool_id = ?").bind(id)] : []),
      db.prepare("DELETE FROM tool_product_bindings WHERE tool_id = ?").bind(id),
      db.prepare("DELETE FROM tools WHERE id = ?").bind(id),
    ]);
    await writeAudit(access.email, "tool.delete", "tool", id, `删除工具 ${tool.name} ${tool.version}${attachments.results.length ? `，含 ${attachments.results.length} 个附件` : ""}`);
    return Response.json({ ok: true, forced: attachments.results.length > 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "工具删除失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
