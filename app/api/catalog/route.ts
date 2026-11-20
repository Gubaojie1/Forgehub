import { DEFAULT_UPLOAD_MAX_MB, getAccess, getD1, getSystemOwnerEmail } from "@/lib/storage";

export const dynamic = "force-dynamic";

const camel = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));

export async function GET(request: Request) {
  try {
    const currentUser = await getAccess(request);
    const db = getD1();
    const [products, releases, protocols, tools, toolFiles, artifacts, replacements, releaseRequests, users, protocolFiles, hardwareVariants, assetTypes, productFiles, auditLogs, materials, materialRequests, materialStats] = await db.batch([
      db.prepare("SELECT * FROM products WHERE archived_at IS NULL ORDER BY code"),
      db.prepare("SELECT r.*, (SELECT GROUP_CONCAT(hv.code, '、') FROM release_hardware_bindings rhb JOIN hardware_variants hv ON hv.id = rhb.hardware_variant_id WHERE rhb.release_id = r.id) AS hardware_scope, (SELECT GROUP_CONCAT(rhb.hardware_variant_id, ',') FROM release_hardware_bindings rhb WHERE rhb.release_id = r.id) AS hardware_variant_ids, (SELECT GROUP_CONCAT(p.name || ' ' || p.version, '、') FROM release_protocol_bindings rpb JOIN protocols p ON p.id = rpb.protocol_id WHERE rpb.release_id = r.id) AS protocol_bindings, (SELECT GROUP_CONCAT(rpb.protocol_id, ',') FROM release_protocol_bindings rpb WHERE rpb.release_id = r.id) AS protocol_ids FROM releases r ORDER BY COALESCE(r.updated_at, r.release_date) DESC"),
      db.prepare("SELECT * FROM protocols ORDER BY updated_at DESC"),
      db.prepare("SELECT t.*, GROUP_CONCAT(tpb.product_id, ',') AS product_ids, GROUP_CONCAT(p.name, '、') AS product_scope FROM tools t LEFT JOIN tool_product_bindings tpb ON tpb.tool_id = t.id LEFT JOIN products p ON p.id = tpb.product_id GROUP BY t.id, t.product_id, t.name, t.version, t.platform, t.updated_at, t.status, t.description ORDER BY t.updated_at DESC"),
      db.prepare("SELECT * FROM tool_files ORDER BY created_at DESC"),
      db.prepare("SELECT * FROM artifacts WHERE status <> '候选' ORDER BY created_at DESC"),
      db.prepare("SELECT rr.*, p.name AS product_name, r.version AS release_version FROM replacement_requests rr JOIN products p ON p.id = rr.product_id JOIN releases r ON r.id = rr.release_id ORDER BY rr.created_at DESC"),
      db.prepare("SELECT pr.*, p.name AS product_name, r.version AS release_version, COALESCE(tu.display_name, pr.assigned_tester_email) AS assigned_tester_name FROM release_requests pr JOIN products p ON p.id = pr.product_id JOIN releases r ON r.id = pr.release_id LEFT JOIN users tu ON lower(tu.email) = lower(pr.assigned_tester_email) ORDER BY pr.created_at DESC"),
      db.prepare("SELECT u.email, u.display_name, u.role, u.status, u.last_login_at, u.must_change_password, u.can_create_products, GROUP_CONCAT(p.name, '、') AS product_scope, GROUP_CONCAT(p.id, ',') AS product_ids FROM users u LEFT JOIN product_permissions pp ON pp.user_email = u.email LEFT JOIN products p ON p.id = pp.product_id GROUP BY u.email, u.display_name, u.role, u.status, u.last_login_at, u.must_change_password, u.can_create_products ORDER BY CASE u.role WHEN 'admin' THEN 1 WHEN 'project_manager' THEN 2 WHEN 'product_owner' THEN 3 WHEN 'tester' THEN 4 WHEN 'developer' THEN 5 ELSE 6 END, u.display_name"),
      db.prepare("SELECT * FROM protocol_files ORDER BY created_at DESC"),
      db.prepare("SELECT * FROM hardware_variants ORDER BY product_id, code"),
      db.prepare("SELECT * FROM product_asset_types ORDER BY product_id, asset_type"),
      db.prepare("SELECT * FROM product_files ORDER BY active DESC, created_at DESC"),
      db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50"),
      db.prepare("SELECT * FROM surplus_materials ORDER BY CASE status WHEN '可领用' THEN 1 WHEN '已领完' THEN 2 ELSE 3 END, updated_at DESC"),
      db.prepare("SELECT mr.*, sm.name AS material_name, sm.publisher_email, sm.publisher_name FROM material_requests mr JOIN surplus_materials sm ON sm.id = mr.material_id ORDER BY mr.created_at DESC"),
      db.prepare("SELECT COALESCE(SUM(mr.quantity), 0) AS shared_quantity, COALESCE(SUM(mr.quantity * COALESCE(mr.unit_price, sm.estimated_unit_price)), 0) AS saved_cost FROM material_requests mr JOIN surplus_materials sm ON sm.id = mr.material_id WHERE mr.status = '已同意'"),
    ]);
    const mapRows = (rows: unknown[]): Array<Record<string, unknown>> => rows.map((row) => camel(row as Record<string, unknown>));
    const systemOwnerEmail = await getSystemOwnerEmail();
    const allProducts = mapRows(products.results).map((item): Record<string, unknown> => ({
      ...item,
      owner: String(item.ownerEmail ?? "").toLowerCase() === systemOwnerEmail ? "系统所有者" : item.owner,
      ownerEmail: String(item.ownerEmail ?? "").toLowerCase() === systemOwnerEmail ? null : item.ownerEmail,
    }));
    const collaborationProducts = new Set(currentUser.isAdmin ? allProducts.map((item) => String(item["id"])) : [...currentUser.productIds, ...currentUser.ownedProductIds]);
    const productRows = allProducts;
    const isCollaborator = (row: Record<string, unknown>) => collaborationProducts.has(String(row.productId));
    const visibleProtocols = mapRows(protocols.results).filter((item) => isCollaborator(item) || item.status === "已发布");
    const visibleProtocolIds = new Set(visibleProtocols.map((item) => String(item.id)));
    const visibleProductFiles = mapRows(productFiles.results).filter((item) => isCollaborator(item));
    // Everyone may browse the product directory, but hardware configuration
    // and controlled material categories are available only to collaborators.
    const visibleHardware = mapRows(hardwareVariants.results).filter(isCollaborator);
    const visibleAssetTypes = mapRows(assetTypes.results).filter(isCollaborator);
    const toolRows = mapRows(tools.results);
    // A tool without a product binding is intentionally shared. Once it is
    // linked to products, both its metadata and files follow product access.
    const visibleTools = toolRows.filter((tool) => {
      const productIds = String(tool.productIds ?? "").split(",").filter(Boolean);
      return productIds.length === 0 || productIds.some((productId) => collaborationProducts.has(productId));
    });
    const visibleToolIds = new Set(visibleTools.map((tool) => String(tool.id)));
    const releaseRequestRows = mapRows(releaseRequests.results);
    const visibleReleaseRequests = releaseRequestRows.filter((item) => collaborationProducts.has(String(item.productId))
      || String(item.assignedTesterEmail ?? "").toLowerCase() === currentUser.email.toLowerCase()
      || String(item.firstReviewedBy ?? "") === currentUser.displayName
      || String(item.reviewedBy ?? "") === currentUser.displayName);
    const workflowReleaseIds = new Set(visibleReleaseRequests.map((item) => String(item.releaseId)));
    const releaseRows = mapRows(releases.results).map((item): Record<string, unknown> => ({ ...item, channel: item.channel === "Stable" ? "正式发布" : item.channel }));
    const trialReleaseIds = new Set(releaseRows.filter((item) => {
      if (item.status !== "已发布" || item.channel !== "小范围试用") return false;
      try { return (JSON.parse(String(item.trialMemberEmails ?? "[]")) as string[]).some((email) => email.toLowerCase() === currentUser.email.toLowerCase()); } catch { return false; }
    }).map((item) => String(item.id)));
    const visibleReleases = releaseRows.filter((item) => workflowReleaseIds.has(String(item.id)) || (item.status === "已发布" && item.channel === "小范围试用" ? currentUser.isAdmin || trialReleaseIds.has(String(item.id)) : isCollaborator(item) || (item.status === "已发布" && item.channel === "正式发布")));
    // Published releases can be listed outside a product team, but raw firmware
    // identifiers, hashes and file metadata remain visible only to collaborators
    // or the tester assigned to that release workflow.
    const releaseById = new Map(releaseRows.map((item) => [String(item.id), item]));
    const confidentialArtifacts = mapRows(artifacts.results).filter((item) => {
      const release = releaseById.get(String(item.releaseId));
      if (release?.status === "已发布" && release.channel === "小范围试用") return currentUser.isAdmin || trialReleaseIds.has(String(item.releaseId)) || workflowReleaseIds.has(String(item.releaseId));
      return isCollaborator(item) || workflowReleaseIds.has(String(item.releaseId));
    });
    const userRows = mapRows(users.results).filter((item) => String(item.email).toLowerCase() !== systemOwnerEmail);
    const ownerCandidates = currentUser.canCreateProduct
      ? userRows.filter((item) => item.status === "active").map((item) => ({ email: item.email, displayName: item.displayName }))
      : [];
    const testerRows = userRows.filter((item) => item.role === "tester" && item.status === "active").map((item) => ({ email: item.email, displayName: item.displayName }));
    const visibleAudits = mapRows(auditLogs.results).map((item) => ({
      ...item,
      actorEmail: String(item.actorEmail).toLowerCase() === systemOwnerEmail ? "系统所有者" : item.actorEmail,
    }));
    const materialRows = mapRows(materials.results);
    const materialSavings = materialStats.results[0] as { shared_quantity?: number; saved_cost?: number } | undefined;
    const materialRequestRows = mapRows(materialRequests.results).filter((item) => currentUser.isAdmin
      || String(item.requesterEmail).toLowerCase() === currentUser.email.toLowerCase()
      || String(item.publisherEmail).toLowerCase() === currentUser.email.toLowerCase());
    const uploadSetting = await db.prepare("SELECT value FROM settings WHERE key = 'upload_max_mb'").first<{ value: string }>();
    const uploadMaxMb = Number(uploadSetting?.value ?? DEFAULT_UPLOAD_MAX_MB);
    return Response.json({
      products: productRows,
      releases: visibleReleases, protocols: visibleProtocols, tools: visibleTools,
      toolFiles: mapRows(toolFiles.results).filter((item) => visibleToolIds.has(String(item.toolId))),
      artifacts: confidentialArtifacts, replacements: mapRows(replacements.results).filter(isCollaborator), releaseRequests: visibleReleaseRequests,
      materials: materialRows, materialRequests: materialRequestRows, materialStats: { sharedQuantity: Number(materialSavings?.shared_quantity ?? 0), savedCost: Number(materialSavings?.saved_cost ?? 0) },
      users: currentUser.isAdmin ? userRows : [], ownerCandidates, testers: currentUser.isAdmin ? testerRows : [], protocolFiles: mapRows(protocolFiles.results).filter((item) => visibleProtocolIds.has(String(item.protocolId))),
      hardwareVariants: visibleHardware, assetTypes: visibleAssetTypes, productFiles: visibleProductFiles, auditLogs: currentUser.isAdmin ? visibleAudits : [], uploadMaxMb: Number.isFinite(uploadMaxMb) ? uploadMaxMb : DEFAULT_UPLOAD_MAX_MB, currentUser,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法读取固件目录" }, { status: 500 });
  }
}
