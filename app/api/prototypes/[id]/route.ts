import { AccessError, getBucket, getD1, writeAudit } from "@/lib/storage";
import { canManagePrototype, findPrototype, prototypeError, prototypeProduct } from "@/lib/prototypes";
async function managedPrototype(request: Request, id: string) {
  const group = await findPrototype(id);
  if (!group) throw new AccessError("原型不存在", 404);
  const { access } = await prototypeProduct(request, group.product_id);
  if (!canManagePrototype(access, group.product_id)) throw new AccessError("只有管理员或该产品负责人可以管理原型");
  return { group, access };
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, group = await findPrototype(id);
    if (!group) throw new AccessError("原型不存在", 404);
    const body = await request.json();
    if (typeof body.name === "string" && body.versionId === undefined) {
      const { access } = await managedPrototype(request, id);
      const name = body.name.trim();
      if (!name || name.length > 80) throw new AccessError("请填写原型名称（80字内）", 400);
      await getD1().prepare("UPDATE prototypes SET name = ? WHERE id = ?").bind(name, id).run();
      await writeAudit(access.email, "prototype.rename", "product", group.product_id, `原型 ${group.name} 改名为 ${name}`);
      return Response.json({ ok: true });
    }
    const { access } = await prototypeProduct(request, group.product_id, true);
    if (typeof body.versionId !== 'string' || !(body.expectedCurrentId === null || typeof body.expectedCurrentId === 'string')) throw new AccessError("请求缺少版本信息，请刷新重试", 400);
    const version = await getD1().prepare("SELECT id FROM prototype_versions WHERE id = ? AND prototype_id = ?").bind(body.versionId, id).first();
    if (!version) throw new AccessError("版本不属于该原型", 404);
    const result = await getD1().prepare("UPDATE prototypes SET current_version_id = ? WHERE id = ? AND current_version_id IS ?").bind(body.versionId, id, body.expectedCurrentId).run();
    if (!result.meta?.changes) throw new AccessError("其他人已更新当前版本，请刷新列表后重试", 409);
    await writeAudit(access.email, "prototype.current", "product", group.product_id, `设置原型 ${group.name} 当前版本 ${body.versionId}`);
    return Response.json({ ok: true });
  } catch (error) { return prototypeError(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { group, access } = await managedPrototype(request, id);
    const db = getD1();
    const versions = await db.prepare("SELECT id, object_key, version FROM prototype_versions WHERE prototype_id = ?").bind(id).all<{ id: string; object_key: string; version: string }>();
    await db.batch([
      ...versions.results.flatMap((version) => [
        db.prepare("DELETE FROM prototype_notes WHERE version_id = ?").bind(version.id),
        db.prepare("DELETE FROM prototype_shares WHERE version_id = ?").bind(version.id),
      ]),
      db.prepare("DELETE FROM prototype_versions WHERE prototype_id = ?").bind(id),
      db.prepare("DELETE FROM prototypes WHERE id = ?").bind(id),
    ]);
    for (const version of versions.results) await getBucket().delete(version.object_key);
    await writeAudit(access.email, "prototype.delete", "product", group.product_id, `删除原型 ${group.name}`);
    return Response.json({ ok: true });
  } catch (error) { return prototypeError(error); }
}
