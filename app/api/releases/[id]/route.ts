import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getD1();
    const existing = await db.prepare("SELECT product_id, status FROM releases WHERE id = ?").bind(id).first<{ product_id: string; status: string }>();
    if (!existing) return Response.json({ error: "固件版本不存在" }, { status: 404 });
    const access = await requireAccess(request, existing.status === "已发布" ? "admin" : "developer", existing.product_id);
    if (["待领取", "测试中", "待审核", "待终审"].includes(existing.status)) return Response.json({ error: "该版本正在测试或审批中，不能修改" }, { status: 409 });
    const body = await request.json() as { version?: string; buildNumber?: string; channel?: string; bootloaderVersion?: string; appVersion?: string; protocolSummary?: string; hardwareVariantIds?: string[]; protocolIds?: string[]; minUpgradeVersion?: string; allowDowngrade?: boolean; releaseNotes?: string; knownIssues?: string; expectedKinds?: string[] };
    const version = body.version?.trim(); const buildNumber = body.buildNumber?.trim();
    if (!version || !buildNumber) return Response.json({ error: "固件版本和构建号不能为空" }, { status: 400 });
    const hardwareIds = body.hardwareVariantIds ?? []; const protocolIds = body.protocolIds ?? [];
    if (hardwareIds.length === 0) return Response.json({ error: "至少选择一个支持的硬件版本" }, { status: 400 });
    const validHardware = await db.prepare(`SELECT COUNT(*) AS total FROM hardware_variants WHERE product_id = ? AND id IN (${hardwareIds.map(() => "?").join(",")})`).bind(existing.product_id, ...hardwareIds).first<{ total: number }>();
    if (validHardware?.total !== new Set(hardwareIds).size) return Response.json({ error: "支持硬件已变化，请重新选择有效的硬件版本" }, { status: 409 });
    const allowedKinds = new Set(["OTA-APP", "OTA-Bootloader", "完整OTA包", "差分OTA包", "线刷包", "配置文件"]);
    const expectedKinds = Array.from(new Set((body.expectedKinds ?? []).map((item) => item.trim()).filter((item) => allowedKinds.has(item))));
    if (expectedKinds.length === 0) return Response.json({ error: "请至少选择一个本版本必需文件" }, { status: 400 });
    const enabledKinds = new Set((await db.prepare("SELECT asset_type FROM product_asset_types WHERE product_id = ?").bind(existing.product_id).all<{ asset_type: string }>()).results.map((item) => item.asset_type));
    if (expectedKinds.some((item) => !enabledKinds.has(item))) return Response.json({ error: "本版本必需文件必须先在产品资料类型中启用" }, { status: 400 });
    const duplicate = await db.prepare("SELECT id FROM releases WHERE product_id = ? AND lower(version) = lower(?) AND build_number = ? AND id <> ?").bind(existing.product_id, version, buildNumber, id).first();
    if (duplicate) return Response.json({ error: "该产品已存在相同的固件版本和构建号，请修改后再保存" }, { status: 409 });
    await db.batch([
      db.prepare("UPDATE releases SET version = ?, build_number = ?, channel = ?, bootloader_version = ?, app_version = ?, protocol_summary = ?, min_upgrade_version = ?, allow_downgrade = ?, release_notes = ?, known_issues = ?, expected_kinds = ?, updated_at = ? WHERE id = ?").bind(version, buildNumber, body.channel || "Dev", body.bootloaderVersion?.trim() || "未指定", body.appVersion?.trim() || version, body.protocolSummary?.trim() || "", body.minUpgradeVersion?.trim() || "", body.allowDowngrade ? 1 : 0, body.releaseNotes?.trim() || "", body.knownIssues?.trim() || "", expectedKinds.join(","), new Date().toISOString(), id),
      db.prepare("DELETE FROM release_hardware_bindings WHERE release_id = ?").bind(id),
      ...hardwareIds.map((hardwareId) => db.prepare("INSERT INTO release_hardware_bindings (release_id, hardware_variant_id) SELECT ?, id FROM hardware_variants WHERE id = ? AND product_id = ?").bind(id, hardwareId, existing.product_id)),
      db.prepare("DELETE FROM release_protocol_bindings WHERE release_id = ?").bind(id),
      ...protocolIds.map((protocolId) => db.prepare("INSERT INTO release_protocol_bindings (release_id, protocol_id) SELECT ?, id FROM protocols WHERE id = ? AND product_id = ?").bind(id, protocolId, existing.product_id)),
    ]);
    await writeAudit(access.email, "release.update", "release", id, `更新固件版本为 ${version}，Build ${buildNumber}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "固件版本更新失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params; const db = getD1();
    const release = await db.prepare("SELECT product_id, version, status FROM releases WHERE id = ?").bind(id).first<{ product_id: string; version: string; status: string }>();
    if (!release) return Response.json({ error: "固件版本不存在" }, { status: 404 });
    const access = await requireAccess(request, release.status === "已发布" ? "admin" : "developer", release.product_id);
    const usage = await db.prepare("SELECT (SELECT COUNT(*) FROM artifacts WHERE release_id = ?) + (SELECT COUNT(*) FROM release_requests WHERE release_id = ?) + (SELECT COUNT(*) FROM replacement_requests WHERE release_id = ?) AS total").bind(id, id, id).first<{ total: number }>();
    if ((usage?.total ?? 0) > 0) return Response.json({ error: "该版本已有文件或审批记录，不能直接删除" }, { status: 409 });
    await db.batch([db.prepare("DELETE FROM release_hardware_bindings WHERE release_id = ?").bind(id), db.prepare("DELETE FROM release_protocol_bindings WHERE release_id = ?").bind(id), db.prepare("DELETE FROM releases WHERE id = ?").bind(id)]);
    await writeAudit(access.email, "release.delete", "release", id, `删除空固件版本 ${release.version}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "固件版本删除失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
