import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

type Action = "approve" | "reject" | "cancel";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { action } = await request.json() as { action?: Action };
    if (action !== "approve" && action !== "reject" && action !== "cancel") return Response.json({ error: "无效操作" }, { status: 400 });

    const access = await requireAccess(request, "viewer");
    const db = getD1();
    const requestRow = await db.prepare("SELECT mr.*, sm.name AS material_name, sm.publisher_email, sm.available_quantity, sm.estimated_unit_price FROM material_requests mr JOIN surplus_materials sm ON sm.id = mr.material_id WHERE mr.id = ?").bind(id).first<{ material_id: string; material_name: string; publisher_email: string; requester_email: string; available_quantity: number; estimated_unit_price: number; quantity: number; status: string }>();
    if (!requestRow || requestRow.status !== "待确认") return Response.json({ error: "该申请不存在或已处理" }, { status: 409 });
    const now = new Date().toISOString();

    if (action === "cancel") {
      if (!access.isAdmin && requestRow.requester_email.toLowerCase() !== access.email.toLowerCase()) throw new AccessError("只能撤销自己的领用申请");
    } else if (!access.isAdmin && requestRow.publisher_email.toLowerCase() !== access.email.toLowerCase()) {
      throw new AccessError("只有发布人可以处理领用申请");
    }
    const status = action === "approve" ? "已同意" : action === "reject" ? "已拒绝" : "已撤销";
    // The state claim and stock update share one transaction. changes() checks
    // whether this invocation won the immediately preceding pending-state claim.
    const results = await db.batch([
      db.prepare("UPDATE material_requests SET status = ?, unit_price = CASE WHEN ? = 'approve' THEN (SELECT estimated_unit_price FROM surplus_materials WHERE id = material_requests.material_id) ELSE unit_price END, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = '待确认' AND (? <> 'approve' OR EXISTS (SELECT 1 FROM surplus_materials WHERE id = material_requests.material_id AND status = '可领用' AND available_quantity >= material_requests.quantity AND reserved_quantity >= material_requests.quantity))").bind(status, action, now, access.displayName, id, action),
      action === "approve"
        ? db.prepare("UPDATE surplus_materials SET available_quantity = available_quantity - ?, reserved_quantity = MAX(reserved_quantity - ?, 0), status = CASE WHEN available_quantity - ? = 0 THEN '已领完' ELSE '可领用' END, updated_at = ? WHERE id = ? AND changes() = 1").bind(requestRow.quantity, requestRow.quantity, requestRow.quantity, now, requestRow.material_id)
        : db.prepare("UPDATE surplus_materials SET reserved_quantity = MAX(reserved_quantity - ?, 0), updated_at = ? WHERE id = ? AND changes() = 1").bind(requestRow.quantity, now, requestRow.material_id),
    ]);
    if ((results[0].meta?.changes ?? 0) !== 1) return Response.json({ error: "申请已被处理，或物料库存/状态已变化，请查看最新结果" }, { status: 409 });
    await writeAudit(access.email, `material.${action}`, "material", requestRow.material_id, `${status}领用申请 ${requestRow.material_name}，${requestRow.quantity} 个`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "处理领用申请失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
