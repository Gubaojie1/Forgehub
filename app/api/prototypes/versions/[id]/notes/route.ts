import { AccessError, getD1, writeAudit } from "@/lib/storage";
import { prototypeError, prototypeProduct } from "@/lib/prototypes";
export const dynamic = "force-dynamic";

type NoteRow = { id: string; body: string; selector: string; x: number; y: number; created_by: string; created_at: string };

async function versionProduct(request: Request, id: string) {
  const version = await getD1().prepare("SELECT v.id, p.product_id, p.name, v.version FROM prototype_versions v JOIN prototypes p ON p.id = v.prototype_id WHERE v.id = ?").bind(id).first<{ id: string; product_id: string; name: string; version: string }>();
  if (!version) throw new AccessError("原型版本不存在", 404);
  const { access } = await prototypeProduct(request, version.product_id);
  return { version, access };
}

async function listNotes(versionId: string) {
  const notes = await getD1().prepare("SELECT id, body, selector, x, y, created_by, created_at FROM prototype_notes WHERE version_id = ? ORDER BY created_at, id").bind(versionId).all<NoteRow>();
  return notes.results;
}

function present(notes: NoteRow[], access: { email: string; canUpload: boolean; isAdmin: boolean; ownedProductIds: string[] }, productId: string) {
  const canModerate = access.canUpload || access.isAdmin || access.ownedProductIds.includes(productId);
  return notes.map((note) => ({ ...note, canDelete: canModerate || note.created_by.toLowerCase() === access.email.toLowerCase() }));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { version, access } = await versionProduct(request, id);
    return Response.json({ notes: present(await listNotes(id), access, version.product_id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { version, access } = await versionProduct(request, id);
    const payload = await request.json().catch(() => null) as { body?: unknown; selector?: unknown; x?: unknown; y?: unknown } | null;
    const body = typeof payload?.body === "string" ? payload.body.trim() : "";
    const selector = typeof payload?.selector === "string" ? payload.selector.trim() : "";
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (!body || body.length > 1000) throw new AccessError("批注需要 1 到 1000 个字", 400);
    if (selector.length > 400) throw new AccessError("批注位置无效", 400);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new AccessError("批注位置无效", 400);
    const count = await getD1().prepare("SELECT COUNT(*) AS count FROM prototype_notes WHERE version_id = ?").bind(id).first<{ count: number }>();
    if ((count?.count ?? 0) >= 200) throw new AccessError("这一版的批注已达到 200 条", 400);
    await getD1().prepare("INSERT INTO prototype_notes (id, version_id, body, selector, x, y, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(`pn-${crypto.randomUUID()}`, id, body, selector, x, y, access.email, new Date().toISOString()).run();
    await writeAudit(access.email, "prototype.note", "product", version.product_id, `批注原型 ${version.name} ${version.version}`);
    return Response.json({ notes: present(await listNotes(id), access, version.product_id) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { version, access } = await versionProduct(request, id);
    const noteId = new URL(request.url).searchParams.get("id") ?? "";
    const note = noteId ? await getD1().prepare("SELECT id, created_by FROM prototype_notes WHERE id = ? AND version_id = ?").bind(noteId, id).first<{ id: string; created_by: string }>() : null;
    if (!note) throw new AccessError("批注不存在", 404);
    const canModerate = access.canUpload || access.isAdmin || access.ownedProductIds.includes(version.product_id);
    if (note.created_by.toLowerCase() !== access.email.toLowerCase() && !canModerate) throw new AccessError("只能删除自己的批注", 403);
    await getD1().prepare("DELETE FROM prototype_notes WHERE id = ? AND version_id = ?").bind(note.id, id).run();
    await writeAudit(access.email, "prototype.note_delete", "product", version.product_id, `删除原型批注 ${version.name} ${version.version}`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return prototypeError(error); }
}
