import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { productIds?: string[]; name?: string; version?: string; platform?: string; status?: string; description?: string };
    const productIds = Array.from(new Set((body.productIds ?? []).map((item) => item.trim()).filter(Boolean)));
    const name = body.name?.trim(); const version = body.version?.trim();
    if (!name || !version) return Response.json({ error: "工具名称和版本不能为空" }, { status: 400 });
    const access = await requireAccess(request, "developer");
    if (!access.isAdmin && productIds.some((id) => !access.productIds.includes(id) && !access.ownedProductIds.includes(id))) throw new AccessError("只能关联您有权限的产品");
    const db = getD1(); const id = `tool-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO tools (id, product_id, name, version, platform, updated_at, status, description) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)").bind(id, name, version, body.platform?.trim() || "跨平台", new Date().toISOString().slice(0, 10), body.status || "维护中", body.description?.trim() || ""),
      ...productIds.map((productId) => db.prepare("INSERT OR IGNORE INTO tool_product_bindings (tool_id, product_id) VALUES (?, ?)").bind(id, productId)),
    ]);
    await writeAudit(access.email, "tool.create", "tool", id, `创建独立工具 ${name} ${version}，关联 ${productIds.length} 个产品`);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "工具创建失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
