import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const access = await requireAccess(request, "viewer");
    const { materialId, quantity, note } = await request.json() as { materialId?: string; quantity?: number; note?: string };
    const count = Number(quantity); const db = getD1();
    if (!materialId || !Number.isInteger(count) || count < 1) return Response.json({ error: "请填写领用数量" }, { status: 400 });
    const material = await db.prepare("SELECT name, available_quantity, reserved_quantity, status, publisher_email FROM surplus_materials WHERE id = ?").bind(materialId).first<{ name: string; available_quantity: number; reserved_quantity: number; status: string; publisher_email: string }>();
    if (!material || material.status !== "可领用") return Response.json({ error: "该物料当前已不可领用" }, { status: 409 });
    if (material.publisher_email.toLowerCase() === access.email.toLowerCase()) return Response.json({ error: "不能申请自己发布的物料" }, { status: 400 });
    const id = `mreq-${crypto.randomUUID()}`; const now = new Date().toISOString();
    const reservation = await db.prepare("UPDATE surplus_materials SET reserved_quantity = reserved_quantity + ?, updated_at = ? WHERE id = ? AND status = '可领用' AND available_quantity - reserved_quantity >= ?").bind(count, now, materialId, count).run();
    if ((reservation.meta?.changes ?? 0) !== 1) return Response.json({ error: "可申请数量已被其他同事预留，请刷新后重试" }, { status: 409 });
    try {
      await db.prepare("INSERT INTO material_requests (id, material_id, requester_email, requester_name, quantity, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, '待确认', ?)").bind(id, materialId, access.email.toLowerCase(), access.displayName, count, note?.trim().slice(0, 200) || "", now).run();
    } catch (error) {
      await db.prepare("UPDATE surplus_materials SET reserved_quantity = MAX(reserved_quantity - ?, 0), updated_at = ? WHERE id = ?").bind(count, now, materialId).run();
      throw error;
    }
    await writeAudit(access.email, "material.request", "material", materialId, `申请领用 ${material.name}，${count} 个`);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "提交领用申请失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
