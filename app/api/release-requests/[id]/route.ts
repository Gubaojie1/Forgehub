import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";

type Action = "claim" | "unclaim" | "pass" | "fail" | "approve" | "reject";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") ?? "";
    let body: { action?: Action; note?: string; scope?: "trial" | "formal"; trialMemberEmails?: string[] };
    let report: File | null = null;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      body = { action: String(form.get("action") ?? "") as Action, note: String(form.get("note") ?? "") };
      const candidate = form.get("report");
      report = candidate instanceof File && candidate.size > 0 ? candidate : null;
    } else {
      body = await request.json() as { action?: Action; note?: string; scope?: "trial" | "formal"; trialMemberEmails?: string[] };
    }
    if (!body.action || !["claim", "unclaim", "pass", "fail", "approve", "reject"].includes(body.action)) return Response.json({ error: "无效操作" }, { status: 400 });
    if (body.scope !== undefined && body.scope !== "trial" && body.scope !== "formal") return Response.json({ error: "无效发布范围" }, { status: 400 });
    const db = getD1();
    const item = await db.prepare("SELECT * FROM release_requests WHERE id = ?").bind(id).first<Record<string, string | null>>();
    if (!item) return Response.json({ error: "任务不存在" }, { status: 404 });
    const now = new Date().toISOString();

    if (body.action === "claim") {
      const access = await requireAccess(request, "tester", item.product_id ?? undefined);
      if (item.status !== "待领取") return Response.json({ error: "该任务已被领取或已经处理" }, { status: 409 });
      const result = await db.prepare("UPDATE release_requests SET status = '测试中', assigned_tester_email = ?, claimed_at = ? WHERE id = ? AND status = '待领取' AND assigned_tester_email IS NULL").bind(access.email.toLowerCase(), now, id).run();
      if ((result.meta?.changes ?? 0) !== 1) return Response.json({ error: "该任务刚刚被其他测试工程师领取" }, { status: 409 });
      await db.batch([
        db.prepare("UPDATE releases SET status = '测试中' WHERE id = ?").bind(item.release_id),
        db.prepare("UPDATE artifacts SET status = '测试中' WHERE release_id = ? AND active = 0 AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')").bind(item.release_id),
      ]);
      await writeAudit(access.email, "release.test_claim", "release", item.release_id ?? "", "领取测试任务");
      return Response.json({ ok: true });
    }

    if (body.action === "unclaim") {
      const access = await requireAccess(request, "tester", item.product_id ?? undefined);
      if (item.status !== "测试中") return Response.json({ error: "该任务当前不能退回任务池" }, { status: 409 });
      if (!access.isAdmin && item.assigned_tester_email?.toLowerCase() !== access.email.toLowerCase()) throw new AccessError("只能退回自己领取的任务");
      await db.batch([
        db.prepare("UPDATE release_requests SET status = '待领取', assigned_tester_email = NULL, claimed_at = NULL WHERE id = ?").bind(id),
        db.prepare("UPDATE releases SET status = '待领取' WHERE id = ?").bind(item.release_id),
        db.prepare("UPDATE artifacts SET status = '待领取' WHERE release_id = ? AND active = 0 AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')").bind(item.release_id),
      ]);
      await writeAudit(access.email, "release.test_unclaim", "release", item.release_id ?? "", "退回测试任务池");
      return Response.json({ ok: true });
    }

    if (body.action === "pass" || body.action === "fail") {
      if (item.status !== "测试中") return Response.json({ error: "该任务尚未领取或已经处理" }, { status: 409 });
      const access = await requireAccess(request, "tester", item.product_id ?? undefined);
      if (!access.isAdmin && item.assigned_tester_email?.toLowerCase() !== access.email.toLowerCase()) throw new AccessError("只有领取人可以提交测试结果");
      const note = body.note?.trim();
      if (!note) return Response.json({ error: "请填写测试结论" }, { status: 400 });
      const passed = body.action === "pass";
      const statements = [
        db.prepare("UPDATE release_requests SET status = ?, test_result = ?, test_notes = ?, tested_by = ?, tested_at = ? WHERE id = ?").bind(passed ? "待终审" : "测试未通过", passed ? "通过" : "未通过", note, access.displayName, now, id),
        db.prepare("UPDATE releases SET status = ? WHERE id = ?").bind(passed ? "待终审" : "草稿", item.release_id),
        db.prepare("UPDATE artifacts SET active = 0, status = ? WHERE release_id = ? AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')").bind(passed ? "待终审" : "草稿", item.release_id),
      ];
      let reportName = "";
      if (report) {
        const maxBytes = await getUploadMaxBytes();
        if (report.size > maxBytes) return Response.json({ error: `测试报告过大，当前单文件上限为 ${Math.floor(maxBytes / 1024 / 1024)} MB` }, { status: 413 });
        const buffer = await report.arrayBuffer();
        const sha256 = await sha256Hex(buffer);
        const reportId = `test-report-${crypto.randomUUID()}`;
        const safeName = report.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectKey = `${item.product_id}/${item.release_id}/test-reports/${reportId}-${safeName}`;
        await getBucket().put(objectKey, buffer, { httpMetadata: { contentType: report.type || "application/octet-stream" }, customMetadata: { sha256, kind: "测试报告" } });
        statements.push(db.prepare("INSERT INTO artifacts (id, release_id, product_id, kind, name, revision, object_key, size, sha256, status, active, uploaded_by, created_at, release_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(reportId, item.release_id, item.product_id, "测试报告", report.name, "测试", objectKey, report.size, sha256, "测试报告", 0, access.displayName, now, id));
        reportName = report.name;
      }
      await db.batch(statements);
      await writeAudit(access.email, passed ? "release.test_pass" : "release.test_fail", "release", item.release_id ?? "", `${passed ? "测试通过，进入审核" : "测试未通过，退回开发"}${reportName ? `；已上传测试报告 ${reportName}` : ""}`);
      return Response.json({ ok: true });
    }

    if (item.status !== "待终审") return Response.json({ error: "该任务当前不在管理员审批阶段" }, { status: 409 });
    const note = body.note?.trim();
    if (body.action === "reject" && !note) return Response.json({ error: "请填写驳回原因" }, { status: 400 });

    const access = await requireAccess(request, "admin", item.product_id ?? undefined);
    const trialMemberEmails = body.scope === "trial" ? [...new Set((body.trialMemberEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))] : [];
    if (body.scope === "trial" && trialMemberEmails.length === 0) return Response.json({ error: "小范围试用至少选择一位同事" }, { status: 400 });
    if (trialMemberEmails.length) {
      const activeUsers = await db.prepare(`SELECT lower(email) AS email FROM users WHERE status = 'active' AND lower(email) IN (${trialMemberEmails.map(() => "?").join(",")})`).bind(...trialMemberEmails).all<{ email: string }>();
      if (activeUsers.results.length !== trialMemberEmails.length) return Response.json({ error: "所选成员中包含已停用或不存在的账号，请刷新后重选" }, { status: 400 });
    }
    if (body.action === "reject") {
      await db.batch([
        db.prepare("UPDATE release_requests SET status = '已驳回', review_comment = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?").bind(note, access.displayName, now, id),
        db.prepare("UPDATE releases SET status = '草稿', channel = '开发验证' WHERE id = ?").bind(item.release_id),
        db.prepare("UPDATE artifacts SET active = 0, status = '草稿' WHERE release_id = ? AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')").bind(item.release_id),
      ]);
      await writeAudit(access.email, "release.final_reject", "release", item.release_id ?? "", "管理员终审驳回");
      return Response.json({ ok: true });
    }
    await publish(db, id, item.release_id ?? "", access.displayName, note, now, body.scope ?? "formal", trialMemberEmails);
    await writeAudit(access.email, "release.final_approve", "release", item.release_id ?? "", body.scope === "trial" ? "管理员终审通过，小范围试用" : "管理员终审通过，正式发布");
    return Response.json({ ok: true, published: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "流程处理失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}

async function publish(db: ReturnType<typeof getD1>, requestId: string, releaseId: string, reviewer: string, note: string | undefined, now: string, scope: "trial" | "formal", trialMemberEmails: string[]) {
  const results = await db.batch([
    db.prepare("UPDATE release_requests SET status = '已批准', reviewed_by = ?, reviewed_at = ?, review_comment = COALESCE(?, review_comment) WHERE id = ? AND status = '待终审'").bind(reviewer, now, note || null, requestId),
    db.prepare("UPDATE releases SET status = '已发布', channel = ?, trial_member_emails = ?, updated_at = ? WHERE id = ? AND changes() = 1").bind(scope === "trial" ? "小范围试用" : "正式发布", JSON.stringify(trialMemberEmails), now, releaseId),
    db.prepare("UPDATE artifacts SET active = 1, status = '已发布' WHERE changes() = 1 AND release_id = ? AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')").bind(releaseId),
  ]);
  if ((results[0].meta?.changes ?? 0) !== 1) throw new AccessError("该审批已被处理，请刷新后查看结果", 409);
}
