import { AccessError, getAccess, getD1, requireAccess, writeAudit } from "@/lib/storage";

type VariantInput = { id?: string; code?: string; mcu?: string; flashSize?: string; ramSize?: string; pcbVersion?: string; minBootloader?: string; interfaces?: string };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await getAccess(request);
    const body = await request.json() as {
      code?: string; name?: string; family?: string; ownerEmail?: string; status?: string; description?: string;
      hardwareVariants?: VariantInput[]; assetTypes?: string[]; memberEmails?: string[];
    };
    const code = body.code?.trim().toUpperCase();
    const name = body.name?.trim();
    const variants = (body.hardwareVariants ?? []).filter((item) => item.code?.trim());
    const assetTypes = Array.from(new Set(["产品立项书", "产品需求文档", ...(body.assetTypes ?? [])]));
    if (!code || !name || variants.length === 0) return Response.json({ error: "产品型号、名称和至少一个硬件版本不能为空" }, { status: 400 });
    const db = getD1();
    const existing = await db.prepare("SELECT id, owner, owner_email, archived_at FROM products WHERE id = ?").bind(id).first<{ id: string; owner: string; owner_email: string | null; archived_at: string | null }>();
    if (!existing) return Response.json({ error: "产品不存在" }, { status: 404 });
    if (existing.archived_at) throw new AccessError("该产品已归档，恢复后才能继续编辑", 409);
    const ownsProduct = access.ownedProductIds.includes(id);
    if (!access.isAdmin && !ownsProduct) throw new AccessError("只有管理员或该产品负责人可以编辑产品");
    let ownerEmail = existing.owner_email || access.email.toLowerCase();
    let ownerName = existing.owner || (access.isSystemOwner ? "系统所有者" : access.displayName);
    if (access.isAdmin && body.ownerEmail?.trim()) {
      const requestedOwner = body.ownerEmail.trim().toLowerCase();
      const ownerUser = await db.prepare("SELECT email, display_name, status FROM users WHERE lower(email) = lower(?)").bind(requestedOwner).first<{ email: string; display_name: string; status: string }>();
      if (!ownerUser || ownerUser.status !== "active") return Response.json({ error: "请选择一名已启用的成员作为产品负责人" }, { status: 400 });
      ownerEmail = ownerUser.email.toLowerCase();
      ownerName = ownerUser.display_name;
    }
    const now = new Date().toISOString();
    const oldVariants = (await db.prepare("SELECT id, code FROM hardware_variants WHERE product_id = ?").bind(id).all<{ id: string; code: string }>()).results;
    const retainedIds = new Set<string>();
    const codes = new Set<string>();
    const hardware = variants.map((variant) => {
      const code = variant.code!.trim().toUpperCase();
      const old = variant.id ? oldVariants.find((item) => item.id === variant.id) : oldVariants.find((item) => item.code.toUpperCase() === code);
      if (variant.id && !old) throw new AccessError("硬件版本已变化，请重新打开产品设置后再保存", 409);
      if (codes.has(code) || (old && retainedIds.has(old.id))) throw new AccessError("硬件版本不能重复", 400);
      codes.add(code);
      const hardwareId = old?.id ?? `hw-${crypto.randomUUID()}`;
      retainedIds.add(hardwareId);
      return { ...variant, id: hardwareId, code, existing: Boolean(old) };
    });
    const removed = oldVariants.filter((item) => !retainedIds.has(item.id));
    for (const variant of removed) {
      const binding = await db.prepare("SELECT release_id FROM release_hardware_bindings WHERE hardware_variant_id = ? LIMIT 1").bind(variant.id).first();
      if (binding) throw new AccessError(`硬件版本 ${variant.code} 已被固件使用，不能移除；请先调整相关固件的硬件绑定`, 409);
    }
    const existingMemberRows = access.isAdmin ? [] : (await db.prepare("SELECT user_email FROM product_permissions WHERE product_id = ?").bind(id).all<{ user_email: string }>()).results;
    const memberEmails = new Set((access.isAdmin ? body.memberEmails ?? [] : existingMemberRows.map((item) => item.user_email)).map((email) => email.trim().toLowerCase()).filter(Boolean));
    memberEmails.add(ownerEmail);
    await db.batch([
      db.prepare("UPDATE products SET code = ?, name = ?, family = ?, hw_versions = ?, owner = ?, owner_email = ?, status = ?, description = ? WHERE id = ?").bind(code, name, body.family?.trim() || "未分类", variants.map((item) => item.code!.trim().toUpperCase()).join(" / "), ownerName, ownerEmail, body.status || "研发", body.description?.trim() || "", id),
      ...removed.map((item) => db.prepare("DELETE FROM hardware_variants WHERE id = ? AND product_id = ? AND NOT EXISTS (SELECT 1 FROM release_hardware_bindings WHERE hardware_variant_id = ?)").bind(item.id, id, item.id)),
      ...hardware.map((item) => item.existing
        ? db.prepare("UPDATE hardware_variants SET code = ?, mcu = ?, flash_size = ?, ram_size = ?, pcb_version = ?, min_bootloader = ?, interfaces = ? WHERE id = ? AND product_id = ?").bind(item.code, item.mcu?.trim() || "待补充", item.flashSize?.trim() || "待补充", item.ramSize?.trim() || "待补充", item.pcbVersion?.trim() || "待补充", item.minBootloader?.trim() || "无要求", item.interfaces?.trim() || "待补充", item.id, id)
        : db.prepare("INSERT INTO hardware_variants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(item.id, id, item.code, item.mcu?.trim() || "待补充", item.flashSize?.trim() || "待补充", item.ramSize?.trim() || "待补充", item.pcbVersion?.trim() || "待补充", item.minBootloader?.trim() || "无要求", item.interfaces?.trim() || "待补充", now)),
      db.prepare("DELETE FROM product_asset_types WHERE product_id = ?").bind(id),
      ...assetTypes.map((assetType) => db.prepare("INSERT OR IGNORE INTO product_asset_types (product_id, asset_type) VALUES (?, ?)").bind(id, assetType)),
      db.prepare("DELETE FROM product_permissions WHERE product_id = ?").bind(id),
      ...Array.from(memberEmails).map((email) => db.prepare("INSERT OR IGNORE INTO product_permissions (user_email, product_id) VALUES (?, ?)").bind(email, id)),
      db.prepare("UPDATE users SET can_create_products = 1 WHERE lower(email) = lower(?)").bind(ownerEmail),
    ]);
    await writeAudit(access.email, "product.update", "product", id, `更新产品 ${code} · ${name}，硬件版本 ${variants.map((item) => item.code).join("、")}`);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品更新失败";
    return Response.json({ error: message.includes("UNIQUE") ? "产品型号或硬件版本重复" : message }, { status: error instanceof AccessError ? error.status : 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireAccess(request, "admin");
    const { id } = await context.params; const db = getD1();
    const product = await db.prepare("SELECT code, name FROM products WHERE id = ?").bind(id).first<{ code: string; name: string }>();
    if (!product) return Response.json({ error: "产品不存在" }, { status: 404 });
    const hasPrototype = await db.prepare("SELECT id FROM prototypes WHERE product_id = ? LIMIT 1").bind(id).first();
    if (hasPrototype && new URL(request.url).searchParams.get("force") !== "true") return Response.json({ error: "该产品已有软件原型，请使用归档操作保留版本资料", canForceDelete: true, confirmationCode: product.code }, { status: 409 });
    const usage = await db.prepare("SELECT (SELECT COUNT(*) FROM releases WHERE product_id = ?) AS releases, (SELECT COUNT(*) FROM protocols WHERE product_id = ?) AS protocols, (SELECT COUNT(*) FROM tool_product_bindings WHERE product_id = ?) AS tools, (SELECT COUNT(*) FROM artifacts WHERE product_id = ?) AS artifacts, (SELECT COUNT(*) FROM product_files WHERE product_id = ?) AS product_files").bind(id, id, id, id, id).first<{ releases: number; protocols: number; tools: number; artifacts: number; product_files: number }>();
    const counts = usage ?? { releases: 0, protocols: 0, tools: 0, artifacts: 0, product_files: 0 };
    const total = counts.releases + counts.protocols + counts.tools + counts.artifacts + counts.product_files;
    const force = new URL(request.url).searchParams.get("force") === "true";
    if (total > 0 && !force) return Response.json({ error: "该产品已有固件、产品资料、协议或工具，只能由管理员强制删除", canForceDelete: true, confirmationCode: product.code, usage: counts }, { status: 409 });
    if (force) {
      const body = await request.json().catch(() => ({})) as { confirmationCode?: string };
      if (body.confirmationCode?.trim() !== product.code) return Response.json({ error: `请输入完整产品型号 ${product.code} 进行确认` }, { status: 400 });
      const now = new Date().toISOString();
      await db.prepare("UPDATE products SET archived_status = status, status = '已归档', archived_at = ?, archived_by = ? WHERE id = ?").bind(now, access.email, id).run();
      await writeAudit(access.email, "product.archive", "product", id, `归档产品 ${product.code} · ${product.name}（固件版本 ${counts.releases}、固件文件 ${counts.artifacts}、产品资料 ${counts.product_files}、协议 ${counts.protocols}、工具 ${counts.tools}）`);
      return Response.json({ ok: true, archived: true });
    }
    await db.batch([
      db.prepare("DELETE FROM release_hardware_bindings WHERE release_id IN (SELECT id FROM releases WHERE product_id = ?)").bind(id),
      db.prepare("DELETE FROM release_protocol_bindings WHERE release_id IN (SELECT id FROM releases WHERE product_id = ?)").bind(id),
      db.prepare("DELETE FROM replacement_requests WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM release_requests WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM artifacts WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM protocol_files WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM product_files WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM protocols WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM tool_product_bindings WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM releases WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM hardware_variants WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM product_asset_types WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM product_permissions WHERE product_id = ?").bind(id),
      db.prepare("DELETE FROM products WHERE id = ?").bind(id),
    ]);
    await writeAudit(access.email, "product.delete", "product", id, `删除空产品 ${product.code} · ${product.name}`);
    return Response.json({ ok: true, forced: false });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "产品删除失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
