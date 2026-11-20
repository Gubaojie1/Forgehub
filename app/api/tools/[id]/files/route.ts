import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: toolId } = await context.params; const db = getD1();
    const tool = await db.prepare("SELECT id FROM tools WHERE id = ?").bind(toolId).first<{ id: string }>();
    if (!tool) return Response.json({ error: "工具不存在" }, { status: 404 });
    const access = await requireAccess(request, "developer");
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "请选择工具文件" }, { status: 400 });
    const maxBytes = await getUploadMaxBytes(); if (file.size > maxBytes) return Response.json({ error: `文件过大，当前单文件上限为 ${Math.floor(maxBytes / 1024 / 1024)} MB` }, { status: 413 });
    const buffer = await file.arrayBuffer(); const sha256 = await sha256Hex(buffer); const id = `tf-${crypto.randomUUID()}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const objectKey = `shared/tools/${toolId}/${id}-${safeName}`;
    await getBucket().put(objectKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { sha256, toolId } });
    await db.prepare("INSERT INTO tool_files VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)").bind(id, toolId, file.name, objectKey, file.size, sha256, access.displayName, new Date().toISOString()).run();
    await writeAudit(access.email, "tool.file.upload", "tool", toolId, `上传工具文件 ${file.name}`);
    return Response.json({ id, sha256 }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "工具文件上传失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
