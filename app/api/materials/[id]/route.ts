import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await requireAccess(request, "viewer");
    const db = getD1();
    const material = await db.prepare("SELECT publisher_email, name, status, available_quantity, reserved_quantity, estimated_unit_price FROM surplus_materials WHERE id = ?").bind(id).first<{ publisher_email: string; name: string; status: string; available_quantity: number; reserved_quantity: number; estimated_unit_price: number }>();
    if (!material) return Response.json({ error: "物料不存在" }, { status: 404 });
    if (!access.isAdmin && material.publisher_email.toLowerCase() !== access.email.toLowerCase()) throw new AccessError("只有发布人可以修改这条物料");

    const { status, availableQuantity, estimatedUnitPrice } = await request.json() as { status?: string; availableQuantity?: number; estimatedUnitPrice?: number };
    if (availableQuantity !== undefined || estimatedUnitPrice !== undefined) {
      const quantity = availableQuantity === undefined ? material.available_quantity : Number(availableQuantity);
      const unitPrice = estimatedUnitPrice === undefined ? Number(material.estimated_unit_price) : Number(estimatedUnitPrice);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10000) return Response.json({ error: "数量请填写 0 至 10000 的整数" }, { status: 400 });
      if (quantity < material.reserved_quantity) return Response.json({ error: `当前已有 ${material.reserved_quantity} 个待确认申请，数量不能低于已预留数量` }, { status: 409 });
      if (!Number.isFinite(unitPrice) || unitPrice < 0.01 || unitPrice > 1000000) return Response.json({ error: "请填写 0.01 至 1000000 元的预估单价" }, { status: 400 });
      const nextStatus = material.status === "已下架" ? "已下架" : quantity === 0 ? "已领完" : "可领用";
      const now = new Date().toISOString();
      await db.prepare("UPDATE surplus_materials SET available_quantity = ?, estimated_unit_price = ?, status = ?, updated_at = ? WHERE id = ?").bind(quantity, unitPrice, nextStatus, now, id).run();
      const changes: string[] = [];
      if (quantity !== material.available_quantity) changes.push(`可领用数量：${material.available_quantity} → ${quantity}`);
      if (unitPrice !== Number(material.estimated_unit_price)) changes.push(`预估单价：¥${Number(material.estimated_unit_price).toFixed(2)} → ¥${unitPrice.toFixed(2)}`);
      await writeAudit(access.email, "material.edit", "material", id, `编辑${material.name}${changes.length ? `，${changes.join("；")}` : ""}`);
      return Response.json({ ok: true });
    }

    if (status !== "已下架" && status !== "可领用") return Response.json({ error: "无效状态" }, { status: 400 });
    await db.prepare("UPDATE surplus_materials SET status = ?, updated_at = ? WHERE id = ?").bind(status, new Date().toISOString(), id).run();
    await writeAudit(access.email, status === "已下架" ? "material.close" : "material.reopen", "material", id, `${status}${material.name}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "更新物料失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
