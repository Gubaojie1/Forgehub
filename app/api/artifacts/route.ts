import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";

function validateFirmwareFile(kind: string, fileName: string) {
  const name = fileName.toLowerCase();
  if (kind !== "线刷包" && name.endsWith(".hex")) return "检测到 .hex 文件：它属于线刷包，请在“线刷包”栏位上传";
  return null;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "请选择固件文件" }, { status: 400 });
    const maxBytes = await getUploadMaxBytes(); if (file.size > maxBytes) return Response.json({ error: `文件过大，当前单文件上限为 ${Math.floor(maxBytes / 1024 / 1024)} MB` }, { status: 413 });
    const productId = String(form.get("productId") ?? "");
    const access = await requireAccess(request, "developer", productId);
    const releaseId = String(form.get("releaseId") ?? "");
    const release = await getD1().prepare("SELECT product_id, status FROM releases WHERE id = ?").bind(releaseId).first<{ product_id: string; status: string }>();
    if (!release || release.product_id !== productId) return Response.json({ error: "固件版本与所选产品不匹配" }, { status: 400 });
    if (release.status === "已发布") return Response.json({ error: "已发布版本保持只读，请新建下一个固件版本后上传文件" }, { status: 409 });
    if (!["草稿", "开发自测"].includes(release.status)) return Response.json({ error: "该版本已进入测试或审批流程，暂时不能追加文件" }, { status: 409 });
    const kind = String(form.get("kind") ?? "固件");
    const revision = String(form.get("revision") ?? "R1");
    const replaceArtifactId = String(form.get("replaceArtifactId") ?? "");
    const fileIssue = validateFirmwareFile(kind, file.name);
    if (fileIssue) return Response.json({ error: fileIssue }, { status: 400 });
    if (replaceArtifactId) {
      if (release.status !== "草稿") return Response.json({ error: "只有草稿版本可以直接替换文件；提交测试后请先退回草稿，或在发布后发起替换申请" }, { status: 409 });
      const source = await getD1().prepare("SELECT id, release_id, product_id, kind, status FROM artifacts WHERE id = ?").bind(replaceArtifactId).first<{ id: string; release_id: string; product_id: string; kind: string; status: string }>();
      if (!source || source.release_id !== releaseId || source.product_id !== productId) return Response.json({ error: "要替换的文件与当前版本不匹配" }, { status: 400 });
      if (source.kind !== kind || ["已替换", "已替代", "已驳回", "候选"].includes(source.status)) return Response.json({ error: "替换文件必须保留原来的文件类型" }, { status: 400 });
    } else {
      const existing = await getD1().prepare("SELECT name FROM artifacts WHERE release_id = ? AND kind = ? AND status NOT IN ('已替换', '已替代', '已驳回', '候选') ORDER BY created_at DESC LIMIT 1").bind(releaseId, kind).first<{ name: string }>();
      if (existing) return Response.json({ error: `该版本的${kind}已存在“${existing.name}”，请使用“替换”更新文件` }, { status: 409 });
    }
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    const id = `art-${crypto.randomUUID()}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectKey = `${productId}/${releaseId}/${id}-${safeName}`;
    await getBucket().put(objectKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { sha256, revision, kind } });
    const now = new Date().toISOString();
    await getD1().batch([
      ...(replaceArtifactId ? [getD1().prepare("UPDATE artifacts SET active = 0, status = '已替换' WHERE id = ?").bind(replaceArtifactId)] : []),
      getD1().prepare("INSERT INTO artifacts (id, release_id, product_id, kind, name, revision, object_key, size, sha256, status, active, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, releaseId, productId, kind, file.name, revision, objectKey, file.size, sha256, "待发布", 0, access.displayName, now),
      getD1().prepare("UPDATE releases SET updated_at = ? WHERE id = ?").bind(now, releaseId),
    ]);
    await writeAudit(access.email, replaceArtifactId ? "artifact.replace_draft" : "artifact.upload", "release", releaseId, `${replaceArtifactId ? "替换" : "上传"}固件文件 ${file.name}（${kind}，SHA-256 ${sha256}）`);
    return Response.json({ id, sha256 }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
