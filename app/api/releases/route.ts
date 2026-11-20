import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { productId?: string; version?: string; buildNumber?: string; channel?: string; bootloaderVersion?: string; appVersion?: string; protocolSummary?: string; hardwareVariantIds?: string[]; protocolIds?: string[]; minUpgradeVersion?: string; allowDowngrade?: boolean; releaseNotes?: string; knownIssues?: string; expectedKinds?: string[] };
    const productId = body.productId?.trim(); const version = body.version?.trim(); const buildNumber = body.buildNumber?.trim();
    if (!productId || !version || !buildNumber) return Response.json({ error: "产品、固件版本和构建号不能为空" }, { status: 400 });
    const access = await requireAccess(request, "developer", productId);
    const product = await getD1().prepare("SELECT code FROM products WHERE id = ?").bind(productId).first<{ code: string }>();
    if (!product) return Response.json({ error: "产品不存在" }, { status: 404 });
    const hardwareIds = body.hardwareVariantIds ?? []; const protocolIds = body.protocolIds ?? [];
    if (hardwareIds.length === 0) return Response.json({ error: "至少选择一个支持的硬件版本" }, { status: 400 });
    const db = getD1();
    const allowedKinds = new Set(["OTA-APP", "OTA-Bootloader", "完整OTA包", "差分OTA包", "线刷包", "配置文件"]);
    const expectedKinds = Array.from(new Set((body.expectedKinds ?? []).map((item) => item.trim()).filter((item) => allowedKinds.has(item))));
    if (expectedKinds.length === 0) return Response.json({ error: "请至少选择一个本版本必需文件" }, { status: 400 });
    const enabledKinds = new Set((await db.prepare("SELECT asset_type FROM product_asset_types WHERE product_id = ?").bind(productId).all<{ asset_type: string }>()).results.map((item) => item.asset_type));
    if (expectedKinds.some((item) => !enabledKinds.has(item))) return Response.json({ error: "本版本必需文件必须先在产品资料类型中启用" }, { status: 400 });
    const duplicate = await db.prepare("SELECT id FROM releases WHERE product_id = ? AND lower(version) = lower(?) AND build_number = ?").bind(productId, version, buildNumber).first();
    if (duplicate) return Response.json({ error: "该产品已存在相同的固件版本和构建号，请修改后再创建" }, { status: 409 });
    const validHardware = await db.prepare(`SELECT COUNT(*) AS total FROM hardware_variants WHERE product_id = ? AND id IN (${hardwareIds.map(() => "?").join(",")})`).bind(productId, ...hardwareIds).first<{ total: number }>();
    if ((validHardware?.total ?? 0) !== hardwareIds.length) return Response.json({ error: "硬件版本与产品不匹配" }, { status: 400 });
    if (protocolIds.length) { const validProtocols = await db.prepare(`SELECT COUNT(*) AS total FROM protocols WHERE product_id = ? AND id IN (${protocolIds.map(() => "?").join(",")})`).bind(productId, ...protocolIds).first<{ total: number }>(); if ((validProtocols?.total ?? 0) !== protocolIds.length) return Response.json({ error: "协议版本与产品不匹配" }, { status: 400 }); }
    const id = `rel-${crypto.randomUUID()}`; const now = new Date().toISOString();
    await db.batch([
      db.prepare("INSERT INTO releases (id, product_id, version, build_number, channel, status, bootloader_version, app_version, protocol_summary, release_date, updated_at, artifact_count, min_upgrade_version, allow_downgrade, release_notes, known_issues, expected_kinds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, productId, version, buildNumber, body.channel || "Dev", "草稿", body.bootloaderVersion?.trim() || "未指定", body.appVersion?.trim() || version, body.protocolSummary?.trim() || "", now.slice(0, 10), now, 0, body.minUpgradeVersion?.trim() || "", body.allowDowngrade ? 1 : 0, body.releaseNotes?.trim() || "", body.knownIssues?.trim() || "", expectedKinds.join(",")),
      ...hardwareIds.map((hardwareId) => db.prepare("INSERT INTO release_hardware_bindings (release_id, hardware_variant_id) VALUES (?, ?)").bind(id, hardwareId)),
      ...protocolIds.map((protocolId) => db.prepare("INSERT INTO release_protocol_bindings (release_id, protocol_id) VALUES (?, ?)").bind(id, protocolId)),
    ]);
    await writeAudit(access.email, "release.create", "release", id, `为 ${product.code} 创建固件版本 ${version}，Build ${buildNumber}`);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "固件版本创建失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
