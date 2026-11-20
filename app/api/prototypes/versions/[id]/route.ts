import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";
import { canManagePrototype, prototypeError, prototypeProduct, PrototypeVersion } from "@/lib/prototypes";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAccess(request, "viewer");
    const { id } = await context.params;
    const version = await getD1().prepare("SELECT v.*, p.product_id FROM prototype_versions v JOIN prototypes p ON p.id = v.prototype_id WHERE v.id = ?").bind(id).first<PrototypeVersion & { product_id: string }>();
    if (!version) throw new AccessError("原型版本不存在", 404);
    const { access } = await prototypeProduct(request, version.product_id);
    const object = await getBucket().get(version.object_key);
    if (!object) throw new AccessError("原型文件不存在，请联系管理员", 404);
    if (new URL(request.url).searchParams.get("download") === "1") return new Response(object.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(version.file_name)}`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    // Never serve uploaded HTML as an executable document on the application origin.
    const html = await new Response(object.body).text();
    const namespace = await sha256Hex(new TextEncoder().encode(`${access.email.toLowerCase()}\n${version.id}`).buffer as ArrayBuffer);
    return Response.json({ html, namespace, versionId: id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}

async function managedVersion(request: Request, id: string) {
  const version = await getD1().prepare("SELECT v.*, p.product_id, p.name AS prototype_name, p.current_version_id FROM prototype_versions v JOIN prototypes p ON p.id = v.prototype_id WHERE v.id = ?").bind(id).first<PrototypeVersion & { product_id: string; prototype_name: string; current_version_id: string | null }>();
  if (!version) throw new AccessError("原型版本不存在", 404);
  const { access } = await prototypeProduct(request, version.product_id);
  if (!canManagePrototype(access, version.product_id)) throw new AccessError("只有管理员或该产品负责人可以管理原型");
  return { version, access };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { version, access } = await managedVersion(request, id);
    const body = await request.json() as { version?: string; changeNote?: string };
    const label = typeof body.version === "string" ? body.version.trim() : "";
    const note = typeof body.changeNote === "string" ? body.changeNote.trim() : "";
    if (!label || label.length > 40 || note.length > 2000) throw new AccessError("请填写版本号（40字内），说明不超过2000字", 400);
    await getD1().prepare("UPDATE prototype_versions SET version = ?, change_note = ? WHERE id = ?").bind(label, note, id).run();
    await writeAudit(access.email, "prototype.version", "product", version.product_id, `修改原型 ${version.prototype_name} 版本 ${version.version} 为 ${label}`);
    return Response.json({ ok: true });
  } catch (error) { return prototypeError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const maxBytes = Math.min(await getUploadMaxBytes(), 10 * 1024 * 1024);
    if (Number(request.headers.get("content-length")) > maxBytes + 65536) throw new AccessError("HTML 文件不能超过 10 MB", 413);
    const { id } = await context.params;
    const { version, access } = await managedVersion(request, id);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !/\.html?$/i.test(file.name) || !file.size) throw new AccessError("请选择非空的 HTML 文件，暂不支持 ZIP", 400);
    if (file.size > maxBytes) throw new AccessError("HTML 文件不能超过 10 MB", 413);
    const bytes = await file.arrayBuffer();
    let html: string;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AccessError("请将 HTML 保存为 UTF-8 编码后上传", 400); }
    if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(html) || html.includes("\0")) throw new AccessError("文件不是完整的 HTML 页面", 400);
    const objectKey = `${version.product_id}/prototypes/${version.prototype_id}/${version.id}-${crypto.randomUUID()}.html`;
    const hash = await sha256Hex(bytes);
    const bucket = getBucket();
    await bucket.put(objectKey, bytes, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    try {
      await getD1().batch([
        getD1().prepare("UPDATE prototype_versions SET file_name = ?, object_key = ?, size = ?, sha256 = ?, uploaded_by = ? WHERE id = ?").bind(file.name, objectKey, file.size, hash, access.displayName, id),
        getD1().prepare("DELETE FROM prototype_notes WHERE version_id = ?").bind(id),
      ]);
    } catch (error) { await bucket.delete(objectKey); throw error; }
    await bucket.delete(version.object_key);
    await writeAudit(access.email, "prototype.replace", "product", version.product_id, `替换原型 ${version.prototype_name} ${version.version} 的 HTML`);
    return Response.json({ ok: true });
  } catch (error) { return prototypeError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { version, access } = await managedVersion(request, id);
    const db = getD1();
    const remaining = await db.prepare("SELECT id FROM prototype_versions WHERE prototype_id = ? AND id <> ? ORDER BY created_at DESC, id DESC LIMIT 1").bind(version.prototype_id, id).first<{ id: string }>();
    await db.batch([
      db.prepare("DELETE FROM prototype_notes WHERE version_id = ?").bind(id),
      db.prepare("DELETE FROM prototype_shares WHERE version_id = ?").bind(id),
      db.prepare("DELETE FROM prototype_versions WHERE id = ?").bind(id),
      ...(remaining
        ? (version.current_version_id === id ? [db.prepare("UPDATE prototypes SET current_version_id = ? WHERE id = ?").bind(remaining.id, version.prototype_id)] : [])
        : [db.prepare("DELETE FROM prototypes WHERE id = ?").bind(version.prototype_id)]),
    ]);
    await getBucket().delete(version.object_key);
    await writeAudit(access.email, "prototype.version_delete", "product", version.product_id, `删除原型 ${version.prototype_name} 版本 ${version.version}`);
    return Response.json({ ok: true });
  } catch (error) { return prototypeError(error); }
}
