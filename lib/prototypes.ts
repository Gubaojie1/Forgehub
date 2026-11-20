import { isShareToken, shareToken } from "@/lib/share-token";
import { AccessError, getD1, requireAccess, requireProductCollaboration, sha256Hex } from "@/lib/storage";

export { isShareToken, shareToken };

export type Prototype = { id: string; product_id: string; name: string; current_version_id: string | null; created_at: string };
export type PrototypeVersion = { id: string; prototype_id: string; version: string; change_note: string; file_name: string; object_key: string; size: number; sha256: string; uploaded_by: string; created_at: string };
export function canManagePrototype(access: { isAdmin: boolean; ownedProductIds?: string[] }, productId: string) {
  return Boolean(access.isAdmin || access.ownedProductIds?.includes(productId));
}
export async function prototypeProduct(request: Request, productId: string, write = false) {
  const access = write ? await requireAccess(request, "developer", productId) : await requireProductCollaboration(request, productId);
  const product = await getD1().prepare("SELECT name, archived_at FROM products WHERE id = ?").bind(productId).first<{ name: string; archived_at: string | null }>();
  if (!product) throw new AccessError("产品不存在", 404);
  if (product.archived_at) throw new AccessError("产品已归档，暂不开放原型", 409);
  return { access, product };
}
export async function findPrototype(id: string) {
  return getD1().prepare("SELECT * FROM prototypes WHERE id = ?").bind(id).first<Prototype>();
}
export function prototypeError(error: unknown) {
  const message = error instanceof Error ? error.message : "原型操作失败";
  const conflict = /UNIQUE constraint/i.test(message);
  return Response.json({ error: conflict ? "原型名称或版本号重复，请刷新后使用已有原型上传新版本" : message }, { status: error instanceof AccessError ? error.status : conflict ? 409 : 500 });
}
export function hashShareToken(token: string) {
  return sha256Hex(new TextEncoder().encode(token));
}
function httpOrigin(value: string, label: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== value.replace(/\/$/, '')) throw new Error(label);
  return url.origin;
}
export function previewOrigin() {
  const value = process.env.PROTOTYPE_PREVIEW_ORIGIN;
  if (!value) return null;
  return httpOrigin(value, "原型预览地址配置不正确");
}
export function shareOrigin() {
  const value = process.env.SHARE_ORIGIN;
  if (!value) return null;
  return httpOrigin(value, "公开链接地址配置不正确");
}
export function sharePagePath(token: string) {
  return `${shareOrigin() ? "/s" : "/prototype/s"}/${token}`;
}
