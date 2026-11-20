import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await requireAccess(request, "admin");
    const db = getD1();
    const release = await db.prepare("SELECT version, status, channel, trial_member_emails FROM releases WHERE id = ?").bind(id).first<{ version: string; status: string; channel: string; trial_member_emails: string }>();
    if (!release) return Response.json({ error: "固件版本不存在" }, { status: 404 });
    if (release.status !== "已发布") return Response.json({ error: "只有已发布的固件版本可以调整发布范围" }, { status: 409 });
    const body = await request.json().catch(() => ({})) as { channel?: string; trialMemberEmails?: string[] };
    const channel = body.channel ?? "正式发布";
    if (channel !== "正式发布" && channel !== "小范围试用") return Response.json({ error: "无效发布范围" }, { status: 400 });
    const emails = channel === "小范围试用" ? [...new Set((body.trialMemberEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))] : [];
    if (channel === "小范围试用" && emails.length === 0) return Response.json({ error: "小范围试用至少需要指定一位同事" }, { status: 400 });
    if (emails.length) {
      const active = await db.prepare(`SELECT lower(email) AS email FROM users WHERE status = 'active' AND lower(email) IN (${emails.map(() => "?").join(",")})`).bind(...emails).all<{ email: string }>();
      if (active.results.length !== emails.length) return Response.json({ error: "所选成员中有不存在或已停用的账号，请核对邮箱" }, { status: 400 });
    }
    if (release.channel === channel && (channel !== "小范围试用" || JSON.stringify(emails) === JSON.stringify(JSON.parse(release.trial_member_emails || "[]")))) return Response.json({ ok: true, unchanged: true });
    const result = await db.prepare("UPDATE releases SET channel = ?, trial_member_emails = ?, updated_at = ? WHERE id = ? AND status = '已发布'").bind(channel, JSON.stringify(emails), new Date().toISOString(), id).run();
    if ((result.meta?.changes ?? 0) !== 1) return Response.json({ error: "发布范围更新失败，请刷新后重试" }, { status: 409 });
    await writeAudit(access.email, "release.scope.change", "release", id, `${release.version}：${release.channel} → ${channel}${emails.length ? `（${emails.length} 位试用同事）` : ""}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "发布范围更新失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
