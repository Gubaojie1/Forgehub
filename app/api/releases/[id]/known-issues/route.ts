import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const db = getD1();
    const release = await db.prepare("SELECT product_id, version, status, known_issues FROM releases WHERE id = ?").bind(id).first<{ product_id: string; version: string; status: string; known_issues: string }>();
    if (!release) return Response.json({ error: "固件版本不存在" }, { status: 404 });
    if (release.status === "已作废") return Response.json({ error: "已作废版本属于归档记录，不能继续修改" }, { status: 409 });
    const access = await requireAccess(request, "viewer"); const knownIssues = ((await request.json()) as { knownIssues?: string }).knownIssues?.trim() ?? "";
    if (knownIssues.length > 5000) return Response.json({ error: "已知问题不能超过 5000 个字符" }, { status: 400 });
    if (knownIssues === (release.known_issues ?? "").trim()) return Response.json({ ok: true, unchanged: true });
    const now = new Date().toISOString();
    await db.batch([db.prepare("UPDATE releases SET known_issues = ? WHERE id = ?").bind(knownIssues, id), db.prepare("INSERT INTO release_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`event-${crypto.randomUUID()}`, id, release.product_id, "release.known_issues", release.status, release.status, access.email, access.displayName, `更新已知问题：${knownIssues || "无"}`, now)]);
    await writeAudit(access.email, "release.known_issues", "release", id, `更新 ${release.version} 的已知问题`);
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "已知问题更新失败" }, { status: error instanceof AccessError ? error.status : 500 }); }
}
