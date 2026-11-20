import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

const priorities = new Set(["紧急", "高", "普通", "低"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { releaseId?: string; priority?: string; expectedAt?: string; summary?: string; verification?: string };
    const db = getD1();
    const release = await db.prepare("SELECT id, product_id, status, release_notes, expected_kinds FROM releases WHERE id = ?").bind(body.releaseId ?? "").first<{ id: string; product_id: string; status: string; release_notes: string; expected_kinds: string }>();
    if (!release) return Response.json({ error: "固件版本不存在" }, { status: 404 });
    const access = await requireAccess(request, "developer", release.product_id);
    if (!body.summary?.trim() || !body.verification?.trim()) return Response.json({ error: "请填写测试说明和开发自测结果" }, { status: 400 });
    if (release.status !== "开发自测") return Response.json({ error: "只有开发自测中的版本可以提交测试" }, { status: 409 });
    const gate = await db.prepare("SELECT (SELECT COUNT(*) FROM artifacts WHERE release_id = ? AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')) AS files, (SELECT COUNT(*) FROM release_hardware_bindings b JOIN hardware_variants h ON h.id = b.hardware_variant_id WHERE b.release_id = ?) AS hardware").bind(release.id, release.id).first<{ files: number; hardware: number }>();
    if ((gate?.files ?? 0) === 0) return Response.json({ error: "请至少上传一个固件文件" }, { status: 409 });
    const uploadedKinds = new Set((await db.prepare("SELECT DISTINCT kind FROM artifacts WHERE release_id = ? AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')").bind(release.id).all<{ kind: string }>()).results.map((item) => item.kind));
    const missingKinds = release.expected_kinds.split(",").filter(Boolean).filter((kind) => !uploadedKinds.has(kind));
    if (missingKinds.length) return Response.json({ error: `本版本还缺少必需文件：${missingKinds.join("、")}` }, { status: 409 });
    if ((gate?.hardware ?? 0) === 0) return Response.json({ error: "请至少绑定一个硬件版本" }, { status: 409 });
    if (!release.release_notes.trim()) return Response.json({ error: "请先填写版本更新说明" }, { status: 409 });
    const pending = await db.prepare("SELECT id FROM release_requests WHERE release_id = ? AND status IN ('待领取', '测试中', '待审核', '待终审')").bind(release.id).first();
    if (pending) return Response.json({ error: "该版本已有正在处理的测试或审批任务" }, { status: 409 });
    const priority = priorities.has(body.priority ?? "") ? body.priority! : "普通";
    const expectedAt = body.expectedAt?.trim() || null;
    const id = `pub-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("INSERT INTO release_requests (id, release_id, product_id, summary, verification, requester, requester_email, status, priority, expected_at, created_at, reviewed_by, reviewed_at, test_result, tested_by, tested_at, assigned_tester_email, claimed_at, test_notes, review_comment, first_reviewed_by, first_reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, release.id, release.product_id, body.summary.trim(), body.verification.trim(), access.displayName, access.email.toLowerCase(), "待领取", priority, expectedAt, now, null, null, null, null, null, null, null, null, null, null, null),
      db.prepare("UPDATE releases SET status = '待领取' WHERE id = ?").bind(release.id),
      db.prepare("UPDATE artifacts SET status = '待领取' WHERE release_id = ? AND active = 0 AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')").bind(release.id),
    ]);
    await writeAudit(access.email, "release.submit_test", "release", release.id, `提交测试任务，优先级：${priority}`);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "测试任务提交失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
