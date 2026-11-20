import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json() as { productId?: string; name?: string; version?: string; interfaceType?: string; status?: string; description?: string };
      const productId = body.productId?.trim(); const name = body.name?.trim(); const version = body.version?.trim();
      if (!productId || !name || !version) return Response.json({ error: "产品、协议名称和版本不能为空" }, { status: 400 });
      const access = await requireAccess(request, "developer", productId); const id = `pro-${crypto.randomUUID()}`;
      if (body.status === "已发布" && !access.isAdmin) throw new AccessError("只有管理员可以直接创建已发布协议");
      await getD1().prepare("INSERT INTO protocols VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, productId, name, version, body.interfaceType?.trim() || "未指定", new Date().toISOString().slice(0, 10), body.status || "草稿", body.description?.trim() || "").run();
      await writeAudit(access.email, "protocol.create", "protocol", id, `创建协议 ${name} ${version}`);
      return Response.json({ id }, { status: 201 });
    }
    const form = await request.formData();
    const file = form.get("file"); const productId = String(form.get("productId") ?? ""); const protocolId = String(form.get("protocolId") ?? "");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "请选择协议附件" }, { status: 400 });
    const maxBytes = await getUploadMaxBytes(); if (file.size > maxBytes) return Response.json({ error: `文件过大，当前单文件上限为 ${Math.floor(maxBytes / 1024 / 1024)} MB` }, { status: 413 });
    const access = await requireAccess(request, "developer", productId);
    const protocol = await getD1().prepare("SELECT id FROM protocols WHERE id = ? AND product_id = ?").bind(protocolId, productId).first();
    if (!protocol) return Response.json({ error: "协议版本不存在" }, { status: 404 });
    const buffer = await file.arrayBuffer(); const sha256 = await sha256Hex(buffer); const id = `pf-${crypto.randomUUID()}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const objectKey = `${productId}/protocols/${protocolId}/${id}-${safeName}`;
    await getBucket().put(objectKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { sha256, protocolId } });
    await getD1().prepare("INSERT INTO protocol_files VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, protocolId, productId, file.name, objectKey, file.size, sha256, access.displayName, new Date().toISOString()).run();
    await writeAudit(access.email, "protocol.file.upload", "protocol", protocolId, `上传协议附件 ${file.name}`);
    return Response.json({ id, sha256 }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "协议附件上传失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
