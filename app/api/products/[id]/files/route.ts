import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";

const labels = { hardware_package: "电路文件", project_charter: "产品立项书", requirements: "产品需求文档" } as const;
type Category = keyof typeof labels;

function allowed(category: Category, name: string) {
  const lower = name.toLowerCase(); const archives = [".zip", ".7z", ".rar", ".tar.gz", ".tgz"];
  return (category === "hardware_package" ? archives : [...archives, ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]).some((suffix) => lower.endsWith(suffix));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: productId } = await context.params; const db = getD1();
    if (!await db.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first()) return Response.json({ error: "产品不存在" }, { status: 404 });
    const access = await requireAccess(request, "developer", productId); const form = await request.formData();
    const category = String(form.get("category") ?? "") as Category; const file = form.get("file");
    const version = String(form.get("version") ?? "").trim(); const changeNote = String(form.get("changeNote") ?? "").trim();
    if (!(category in labels)) return Response.json({ error: "请选择产品资料类型" }, { status: 400 });
    if (category !== "hardware_package" && !version) return Response.json({ error: "请填写文档版本号" }, { status: 400 });
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "请选择要上传的文件" }, { status: 400 });
    const maxBytes = await getUploadMaxBytes(); if (file.size > maxBytes) return Response.json({ error: `文件过大，当前单文件上限为 ${Math.floor(maxBytes / 1024 / 1024)} MB` }, { status: 413 });
    if (!allowed(category, file.name)) return Response.json({ error: category === "hardware_package" ? "电路文件请先打包为 ZIP、7Z、RAR、TAR.GZ 或 TGZ" : "立项书和需求文档支持 PDF、Office 文档或压缩包" }, { status: 400 });
    const buffer = await file.arrayBuffer(); const sha256 = await sha256Hex(buffer); const id = `pf-${crypto.randomUUID()}`;
    const objectKey = `${productId}/product-files/${category}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`; const now = new Date().toISOString();
    await getBucket().put(objectKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { sha256, productId, category } });
    try { await db.batch([db.prepare("UPDATE product_files SET active = 0 WHERE product_id = ? AND category = ? AND active = 1").bind(productId, category), db.prepare("INSERT INTO product_files (id, product_id, category, file_name, object_key, size, sha256, active, version, change_note, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)").bind(id, productId, category, file.name, objectKey, file.size, sha256, version || "V1.0", changeNote, access.displayName, now)]); }
    catch (error) { await getBucket().delete(objectKey); throw error; }
    await writeAudit(access.email, "product.file.upload", "product", productId, `上传${labels[category]} ${file.name}（SHA-256 ${sha256}）`);
    return Response.json({ id, sha256 }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "产品资料上传失败" }, { status: error instanceof AccessError ? error.status : 500 }); }
}
