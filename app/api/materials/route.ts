import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

const categories = new Set(["模块", "芯片", "传感器", "PCB", "线材", "其他"]);

export async function POST(request: Request) {
  try {
    const access = await requireAccess(request, "viewer");
    const body = await request.json() as { name?: string; quantity?: number; estimatedUnitPrice?: number; category?: string; note?: string };
    const name = body.name?.trim();
    const quantity = Number(body.quantity);
    const estimatedUnitPrice = Number(body.estimatedUnitPrice);
    const category = categories.has(body.category ?? "") ? body.category! : "其他";
    if (!name || name.length > 120) return Response.json({ error: "请填写物料名称或型号" }, { status: 400 });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return Response.json({ error: "数量请填写 1 至 10000 的整数" }, { status: 400 });
    if (!Number.isFinite(estimatedUnitPrice) || estimatedUnitPrice < 0.01 || estimatedUnitPrice > 1000000) return Response.json({ error: "请填写 0.01 至 1000000 元的预估单价" }, { status: 400 });
    const now = new Date().toISOString(); const id = `mat-${crypto.randomUUID()}`;
    await getD1().prepare("INSERT INTO surplus_materials (id, name, category, quantity, available_quantity, estimated_unit_price, note, status, publisher_email, publisher_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '可领用', ?, ?, ?, ?)").bind(id, name, category, quantity, quantity, estimatedUnitPrice, body.note?.trim().slice(0, 300) || "", access.email.toLowerCase(), access.displayName, now, now).run();
    await writeAudit(access.email, "material.publish", "material", id, `发布研发物料：${name}，${quantity} 个，预估单价 ¥${estimatedUnitPrice}/个`);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "发布物料失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
