import { AccessError, getBucket, getD1, getUploadMaxBytes, requireAccess, sha256Hex, writeAudit } from "@/lib/storage";
import { canManagePrototype, findPrototype, previewOrigin, prototypeError, prototypeProduct, shareOrigin, PrototypeVersion } from "@/lib/prototypes";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAccess(request, "viewer");
    const query = new URL(request.url).searchParams;
    const group = query.get("prototype") ? await findPrototype(query.get("prototype")!) : null;
    if (query.has("prototype") && !group) throw new AccessError("原型不存在", 404);
    const productId = group?.product_id ?? query.get("productId") ?? "";
    const { access, product } = await prototypeProduct(request, productId);
    const db = getD1();
    const groups = await db.prepare("SELECT * FROM prototypes WHERE product_id = ? ORDER BY created_at DESC, id").bind(productId).all();
    const versions = await db.prepare("SELECT v.id, v.prototype_id, v.version, v.change_note, v.file_name, v.size, v.sha256, v.uploaded_by, v.created_at, EXISTS(SELECT 1 FROM prototype_shares s WHERE s.version_id = v.id AND s.revoked_at IS NULL) AS share_active, (SELECT s.token FROM prototype_shares s WHERE s.version_id = v.id AND s.revoked_at IS NULL) AS share_token FROM prototype_versions v JOIN prototypes p ON p.id = v.prototype_id WHERE p.product_id = ? ORDER BY v.created_at DESC, v.id").bind(productId).all();
    return Response.json({ productId, productName: product.name, prototypes: groups.results, versions: versions.results, previewOrigin: previewOrigin(), shareOrigin: shareOrigin(), canUpload: access.isAdmin || access.canUpload || access.ownedProductIds.includes(productId), canManage: canManagePrototype(access, productId), maxBytes: Math.min(await getUploadMaxBytes(), 10 * 1024 * 1024) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}

export async function POST(request: Request) {
  try {
    await requireAccess(request, "viewer");
    const maxBytes = Math.min(await getUploadMaxBytes(), 10 * 1024 * 1024);
    if (Number(request.headers.get('content-length')) > maxBytes + 65536) throw new AccessError("HTML 文件不能超过 10 MB", 413);
    const form = await request.formData();
    const productId = String(form.get("productId") ?? "");
    const { access } = await prototypeProduct(request, productId, true);
    const groupId = String(form.get("prototypeId") ?? "");
    const group = groupId ? await findPrototype(groupId) : null;
    if (groupId && (!group || group.product_id !== productId)) throw new AccessError("原型不属于当前产品", 404);
    const name = group?.name ?? String(form.get("name") ?? "").trim();
    const version = String(form.get("version") ?? "").trim();
    const note = String(form.get("changeNote") ?? "").trim();
    if (!name || name.length > 80 || !version || version.length > 40 || note.length > 2000) throw new AccessError("请填写原型名称（80字内）、版本号（40字内），说明不超过2000字", 400);
    const file = form.get("file");
    if (!(file instanceof File) || !/\.html?$/i.test(file.name) || !file.size) throw new AccessError("请选择非空的 HTML 文件，暂不支持 ZIP", 400);
    if (file.size > maxBytes) throw new AccessError("HTML 文件不能超过 10 MB", 413);
    const bytes = await file.arrayBuffer();
    let html: string;
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new AccessError("请将 HTML 保存为 UTF-8 编码后上传", 400); }
    if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(html) || html.includes('\0')) throw new AccessError("文件不是完整的 HTML 页面", 400);
    const id = `pv-${crypto.randomUUID()}`, prototypeId = group?.id ?? `pt-${crypto.randomUUID()}`;
    const objectKey = `${productId}/prototypes/${prototypeId}/${id}.html`;
    const hash = await sha256Hex(bytes), now = new Date().toISOString(), db = getD1();
    await getBucket().put(objectKey, bytes, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    try {
      await db.batch([
        ...(!group ? [db.prepare("INSERT INTO prototypes (id, product_id, name, current_version_id, created_at) VALUES (?, ?, ?, NULL, ?)").bind(prototypeId, productId, name, now)] : []),
        db.prepare("INSERT INTO prototype_versions (id, prototype_id, version, change_note, file_name, object_key, size, sha256, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, prototypeId, version, note, file.name, objectKey, file.size, hash, access.displayName, now),
      ]);
    } catch (error) { await getBucket().delete(objectKey); throw error; }
    await writeAudit(access.email, "prototype.upload", "product", productId, `上传原型 ${name} ${version}，尚未设为当前版本`);
    return Response.json({ id, prototypeId }, { status: 201 });
  } catch (error) { return prototypeError(error); }
}
