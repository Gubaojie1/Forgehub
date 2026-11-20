import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "请选择候选文件" }, { status: 400 });
    const maxBytes = await getUploadMaxBytes(); if (file.size > maxBytes) return Response.json({ error: `文件过大，当前单文件上限为 ${Math.floor(maxBytes / 1024 / 1024)} MB` }, { status: 413 });
    const sourceArtifactId = String(form.get("sourceArtifactId") ?? "");
    const db = getD1();
    const source = await db.prepare("SELECT * FROM artifacts WHERE id = ? AND active = 1").bind(sourceArtifactId).first<Record<string, string | number>>();
    if (!source) return Response.json({ error: "未找到当前生效文件" }, { status: 404 });
    const productId = String(source.product_id); const releaseId = String(source.release_id);
    const access = await requireAccess(request, "developer", productId);
    const newRevision = String(form.get("newRevision") ?? ""); const reason = String(form.get("reason") ?? ""); const impact = String(form.get("impact") ?? "");
    if (!newRevision || !reason || !impact) return Response.json({ error: "请完整填写替换信息" }, { status: 400 });
    const buffer = await file.arrayBuffer(); const sha256 = await sha256Hex(buffer);
    const candidateId = `art-${crypto.randomUUID()}`; const requestId = `rep-${crypto.randomUUID()}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const objectKey = `${productId}/${releaseId}/candidates/${candidateId}-${safeName}`;
    await getBucket().put(objectKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { sha256, revision: newRevision, approval: "pending" } });
    const actor = access.displayName; const createdAt = new Date().toISOString();
    await db.batch([
      db.prepare("INSERT INTO artifacts (id, release_id, product_id, kind, name, revision, object_key, size, sha256, status, active, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(candidateId, releaseId, productId, source.kind, source.name, newRevision, objectKey, file.size, sha256, "候选", 0, actor, createdAt),
      db.prepare("INSERT INTO replacement_requests (id, product_id, release_id, source_artifact_id, candidate_artifact_id, artifact_name, current_revision, new_revision, reason, impact, requester, status, created_at, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(requestId, productId, releaseId, sourceArtifactId, candidateId, source.name, source.revision, newRevision, reason, impact, actor, "待审批", createdAt, null, null),
    ]);
    await writeAudit(access.email, "replacement.request", "replacement", requestId, `提交文件替换申请：${source.name}，${source.revision} → ${newRevision}`);
    return Response.json({ id: requestId, sha256 }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "替换申请提交失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
