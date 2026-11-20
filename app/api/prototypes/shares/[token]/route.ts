import { AccessError, ensureAndSeed, getBucket, getD1, sha256Hex } from "@/lib/storage";
import { hashShareToken, isShareToken, previewOrigin, prototypeError } from "@/lib/prototypes";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!isShareToken(token)) throw new AccessError("分享链接已失效", 404);
    await ensureAndSeed();
    const tokenHash = await hashShareToken(token);
    const row = await getD1().prepare("SELECT s.version_id, v.version, v.object_key, p.name AS prototype_name, pr.archived_at FROM prototype_shares s JOIN prototype_versions v ON v.id = s.version_id JOIN prototypes p ON p.id = v.prototype_id JOIN products pr ON pr.id = p.product_id WHERE s.token_hash = ? AND s.revoked_at IS NULL").bind(tokenHash).first<{ version_id: string; version: string; object_key: string; prototype_name: string; archived_at: string | null }>();
    if (!row || row.archived_at) throw new AccessError("分享链接已失效", 404);
    const object = await getBucket().get(row.object_key);
    if (!object) throw new AccessError("分享链接已失效", 404);
    const html = await new Response(object.body).text();
    const namespace = await sha256Hex(new TextEncoder().encode(`public\n${tokenHash}`));
    const notes = await getD1().prepare("SELECT id, body, selector, x, y, created_by, created_at FROM prototype_notes WHERE version_id = ? ORDER BY created_at, id").bind(row.version_id).all<{ id: string; body: string; selector: string; x: number; y: number; created_by: string; created_at: string }>();
    return Response.json({ html, namespace, versionId: row.version_id, origin: previewOrigin(), title: `${row.prototype_name} · ${row.version}`, notes: notes.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}
