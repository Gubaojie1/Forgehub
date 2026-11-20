import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const payload = await request.json() as { action?: "approve" | "reject" };
    if (payload.action !== "approve" && payload.action !== "reject") return Response.json({ error: "无效操作" }, { status: 400 });
    const db = getD1();
    const item = await db.prepare("SELECT * FROM replacement_requests WHERE id = ? AND status = '待审批'").bind(id).first<Record<string, string>>();
    if (!item) return Response.json({ error: "申请不存在或已处理" }, { status: 404 });
    const access = await requireAccess(request, "admin", item.product_id);
    const actor = access.displayName; const reviewedAt = new Date().toISOString();
    if (payload.action === "approve") {
      await db.batch([
        db.prepare("UPDATE artifacts SET active = 0, status = '已替代' WHERE id = ?").bind(item.source_artifact_id),
        db.prepare("UPDATE artifacts SET active = 1, status = '已发布' WHERE id = ?").bind(item.candidate_artifact_id),
        db.prepare("UPDATE replacement_requests SET status = '已批准', reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(actor, reviewedAt, id),
      ]);
      await writeAudit(access.email, "replacement.approve", "replacement", id, `批准文件替换申请：${item.artifact_name}，${item.current_revision} → ${item.new_revision}`);
    } else {
      await db.batch([
        db.prepare("UPDATE artifacts SET status = '已驳回' WHERE id = ?").bind(item.candidate_artifact_id),
        db.prepare("UPDATE replacement_requests SET status = '已驳回', reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(actor, reviewedAt, id),
      ]);
      await writeAudit(access.email, "replacement.reject", "replacement", id, `驳回文件替换申请：${item.artifact_name}，${item.current_revision} → ${item.new_revision}`);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "审批失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
