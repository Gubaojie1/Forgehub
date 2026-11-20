import { AccessError, getD1, writeAudit } from "@/lib/storage";
import { hashShareToken, prototypeError, prototypeProduct, shareOrigin, sharePagePath, shareToken } from "@/lib/prototypes";
export const dynamic = "force-dynamic";

async function versionProduct(request: Request, id: string) {
  const version = await getD1().prepare("SELECT v.id, p.product_id, p.name, v.version FROM prototype_versions v JOIN prototypes p ON p.id = v.prototype_id WHERE v.id = ?").bind(id).first<{ id: string; product_id: string; name: string; version: string }>();
  if (!version) throw new AccessError("原型版本不存在", 404);
  const { access } = await prototypeProduct(request, version.product_id);
  return { version, access };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { version, access } = await versionProduct(request, id);
    const db = getD1();
    const active = await db.prepare("SELECT id FROM prototype_shares WHERE version_id = ? AND revoked_at IS NULL").bind(id).first();
    if (active) throw new AccessError("该版本已在公开分享，请先停止分享", 409);
    const token = shareToken();
    await db.prepare("INSERT INTO prototype_shares (id, version_id, token_hash, token, created_by, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").bind(`ps-${crypto.randomUUID()}`, id, await hashShareToken(token), token, access.email, new Date().toISOString()).run();
    await writeAudit(access.email, "prototype.share", "product", version.product_id, `公开分享原型 ${version.name} ${version.version}`);
    const path = sharePagePath(token);
    const configured = shareOrigin();
    return Response.json({ token, path, url: configured ? `${configured}${path}` : path }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { version, access } = await versionProduct(request, id);
    const result = await getD1().prepare("UPDATE prototype_shares SET revoked_at = ? WHERE version_id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), id).run();
    if (!result.meta?.changes) throw new AccessError("该版本没有公开分享", 404);
    await writeAudit(access.email, "prototype.share_revoke", "product", version.product_id, `停止公开分享原型 ${version.name} ${version.version}`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}
