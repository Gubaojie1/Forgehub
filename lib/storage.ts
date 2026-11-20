import { env } from "@/lib/platform-env";
import { publishRealtimeEvent } from "@/lib/realtime";
import { sessionTokenFromRequest, verifySession } from "@/lib/selfhost-auth";

type FirmwareEnv = { DB?: D1Database; FIRMWARE_BUCKET?: R2Bucket };
const runtime = env as unknown as FirmwareEnv;

export function getD1() {
  if (!runtime.DB) throw new Error("D1 database binding is unavailable");
  return runtime.DB;
}

export function getBucket() {
  if (!runtime.FIRMWARE_BUCKET) throw new Error("Firmware bucket binding is unavailable");
  return runtime.FIRMWARE_BUCKET;
}

export function actorFrom(request: Request) {
  return identityFrom(request)?.displayName ?? "unknown";
}

export function identityFrom(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email");
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  if (encoded && encoding === "percent-encoded-utf-8") {
    try { return { email: email?.toLowerCase() ?? "", displayName: decodeURIComponent(encoded) }; } catch { /* fall through */ }
  }
  return { email: email?.toLowerCase() ?? "", displayName: email?.split("@")[0] ?? "" };
}

async function verifiedIdentityFrom(request: Request) {
  if (process.env.SELF_HOSTED === "true") {
    const session = await verifySession(sessionTokenFromRequest(request));
    if (!session) throw new AccessError("Login session expired", 401);
    return { email: session.email.toLowerCase(), displayName: session.name };
  }
  const identity = identityFrom(request);
  if (!identity.email) throw new AccessError("Authentication required", 401);
  return identity;
}

export type UserRole = "viewer" | "developer" | "tester" | "product_owner" | "project_manager" | "admin";

function capabilities(role: UserRole) {
  const isAdmin = role === "admin";
  return {
    isAdmin,
    canUpload: isAdmin || role === "developer",
    canTest: isAdmin || role === "tester",
    canApprove: isAdmin,
  };
}

export async function getSystemOwnerEmail() {
  if (process.env.SELF_HOSTED === "true") return (process.env.ADMIN_EMAIL || "admin@forgehub.local").toLowerCase();
  const owner = await getD1().prepare("SELECT value FROM settings WHERE key = 'site_owner_email'").first<{ value: string }>();
  return owner?.value?.toLowerCase() ?? "";
}

export const DEFAULT_UPLOAD_MAX_MB = 200;
export const LARGE_UPLOAD_WARNING_MB = 50;

export async function getUploadMaxBytes() {
  const stored = await getD1().prepare("SELECT value FROM settings WHERE key = 'upload_max_mb'").first<{ value: string }>();
  const mb = Number(stored?.value ?? DEFAULT_UPLOAD_MAX_MB);
  const safeMb = Number.isFinite(mb) && mb >= 10 && mb <= 1024 ? Math.floor(mb) : DEFAULT_UPLOAD_MAX_MB;
  return safeMb * 1024 * 1024;
}

export class AccessError extends Error { constructor(message: string, public status = 403) { super(message); } }

export async function getAccess(request: Request) {
  await ensureAndSeed();
  const db = getD1();
  const identity = await verifiedIdentityFrom(request);
  const isPlatformPreview = identity.email === "sites-screenshot-service-noreply@chatgpt.com";
  let owner = await db.prepare("SELECT value FROM settings WHERE key = 'site_owner_email'").first<{ value: string }>();
  if (owner?.value === "sites-screenshot-service-noreply@chatgpt.com") {
    await db.batch([
      db.prepare("DELETE FROM settings WHERE key = 'site_owner_email'"),
      db.prepare("DELETE FROM users WHERE email = 'sites-screenshot-service-noreply@chatgpt.com'"),
    ]);
    owner = null;
  }
  if (isPlatformPreview) {
    return { ...identity, role: "viewer" as UserRole, status: "active", productIds: [], ownedProductIds: [], isSystemOwner: false, isAdmin: false, canCreateProduct: false, canUpload: false, canTest: false, canApprove: false };
  }
  const selfHosted = process.env.SELF_HOSTED === "true";
  const selfHostedAdminEmail = (process.env.ADMIN_EMAIL || "admin@forgehub.local").toLowerCase();
  const isSelfHostedAdmin = selfHosted && identity.email.toLowerCase() === selfHostedAdminEmail;
  if (!owner && (!selfHosted || isSelfHostedAdmin)) {
    await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('site_owner_email', ?)").bind(identity.email).run();
    owner = await db.prepare("SELECT value FROM settings WHERE key = 'site_owner_email'").first<{ value: string }>();
  }
  const isOwner = selfHosted ? isSelfHostedAdmin : owner?.value === identity.email;
  if (selfHosted && !isSelfHostedAdmin) {
    const existing = await db.prepare("SELECT email FROM users WHERE lower(email) = lower(?)").bind(identity.email).first<{ email: string }>();
    if (!existing) throw new AccessError("账号不存在或已被删除", 401);
  }
  await db.prepare("INSERT INTO users (email, display_name, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, role = CASE WHEN ? THEN 'admin' ELSE users.role END").bind(identity.email, identity.displayName, isOwner ? "admin" : "viewer", new Date().toISOString(), isOwner ? 1 : 0).run();
  const user = await db.prepare("SELECT role, status, can_create_products FROM users WHERE email = ?").bind(identity.email).first<{ role: UserRole; status: string; can_create_products: number }>();
  if (user?.status === "disabled") throw new AccessError("该账号已被停用，请联系管理员", 403);
  await db.prepare("UPDATE users SET last_login_at = ? WHERE email = ?").bind(new Date().toISOString(), identity.email).run();
  const permissions = await db.prepare("SELECT pp.product_id FROM product_permissions pp JOIN products p ON p.id = pp.product_id WHERE pp.user_email = ? AND p.archived_at IS NULL").bind(identity.email).all<{ product_id: string }>();
  const ownedProducts = await db.prepare("SELECT id FROM products WHERE lower(owner_email) = lower(?) AND archived_at IS NULL").bind(identity.email).all<{ id: string }>();
  const role = isOwner ? "admin" : (user?.role ?? "viewer");
  const workflowProducts = role === "tester"
    ? await db.prepare("SELECT DISTINCT product_id FROM release_requests WHERE status IN ('待领取', '测试中') AND lower(assigned_tester_email) = lower(?)").bind(identity.email).all<{ product_id: string }>()
    : role === "admin"
      ? await db.prepare("SELECT DISTINCT product_id FROM release_requests WHERE status = '待终审'").all<{ product_id: string }>()
      : { results: [] as Array<{ product_id: string }> };
  return {
    ...identity,
    role,
    status: user?.status ?? "active",
    productIds: Array.from(new Set([...permissions.results, ...workflowProducts.results].map((item) => item.product_id))),
    ownedProductIds: ownedProducts.results.map((item) => item.id),
    isSystemOwner: isOwner,
    canCreateProduct: isOwner || role === "admin" || role === "product_owner" || role === "project_manager" || Boolean(user?.can_create_products),
    ...capabilities(role),
  };
}

export async function requireAccess(request: Request, minimum: UserRole, productId?: string) {
  const access = await getAccess(request);
  const ownsProduct = Boolean(productId && access.ownedProductIds.includes(productId));
  const allowed = minimum === "viewer"
    || (minimum === "developer" && (access.canUpload || ownsProduct))
    || (minimum === "tester" && access.canTest)
    || (minimum === "admin" && access.isAdmin);
  if (!allowed) throw new AccessError("当前角色无权执行此操作");
  if (productId && minimum !== "viewer" && access.role !== "admin" && !access.productIds.includes(productId) && !ownsProduct) throw new AccessError("您没有该产品的操作权限");
  return access;
}

/** Requires an explicit product collaboration relationship, including for downloads. */
export async function requireProductCollaboration(request: Request, productId: string) {
  const access = await requireAccess(request, "viewer");
  const ownsProduct = access.ownedProductIds.includes(productId);
  if (!access.isAdmin && !ownsProduct && !access.productIds.includes(productId)) {
    throw new AccessError("您没有该产品资料的访问权限");
  }
  return access;
}

let ensurePromise: Promise<void> | null = null;

export async function ensureAndSeed() {
  if (!ensurePromise) {
    ensurePromise = runEnsureAndSeed().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

async function runEnsureAndSeed() {
  const db = getD1();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS prototypes (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, current_version_id TEXT, created_at TEXT NOT NULL, UNIQUE(product_id, name))"),
    db.prepare("CREATE TABLE IF NOT EXISTS prototype_versions (id TEXT PRIMARY KEY, prototype_id TEXT NOT NULL, version TEXT NOT NULL COLLATE NOCASE, change_note TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL, object_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(prototype_id, version))"),
    db.prepare("CREATE TABLE IF NOT EXISTS prototype_shares (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS prototype_shares_active_idx ON prototype_shares(version_id) WHERE revoked_at IS NULL"),
    db.prepare("CREATE TABLE IF NOT EXISTS prototype_notes (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, body TEXT NOT NULL, selector TEXT NOT NULL DEFAULT '', x REAL NOT NULL, y REAL NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS prototype_notes_version_idx ON prototype_notes(version_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, family TEXT NOT NULL, hw_versions TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL, owner_email TEXT, archived_at TEXT, archived_by TEXT, archived_status TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, version TEXT NOT NULL, build_number TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, bootloader_version TEXT NOT NULL, app_version TEXT NOT NULL, protocol_summary TEXT NOT NULL, release_date TEXT NOT NULL, updated_at TEXT, artifact_count INTEGER NOT NULL DEFAULT 0, min_upgrade_version TEXT NOT NULL DEFAULT '', allow_downgrade INTEGER NOT NULL DEFAULT 0, release_notes TEXT NOT NULL DEFAULT '', known_issues TEXT NOT NULL DEFAULT '', expected_kinds TEXT NOT NULL DEFAULT '', trial_member_emails TEXT NOT NULL DEFAULT '[]')"),
    db.prepare("CREATE TABLE IF NOT EXISTS release_hardware_bindings (id INTEGER PRIMARY KEY AUTOINCREMENT, release_id TEXT NOT NULL, hardware_variant_id TEXT NOT NULL, UNIQUE(release_id, hardware_variant_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS release_protocol_bindings (id INTEGER PRIMARY KEY AUTOINCREMENT, release_id TEXT NOT NULL, protocol_id TEXT NOT NULL, UNIQUE(release_id, protocol_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS protocols (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, interface_type TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS tools (id TEXT PRIMARY KEY, product_id TEXT, name TEXT NOT NULL, version TEXT NOT NULL, platform TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS tool_product_bindings (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_id TEXT NOT NULL, product_id TEXT NOT NULL, UNIQUE(tool_id, product_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS tool_files (id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, product_id TEXT, file_name TEXT NOT NULL, object_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, release_id TEXT NOT NULL, product_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL, object_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, status TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL, release_request_id TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS replacement_requests (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, release_id TEXT NOT NULL, source_artifact_id TEXT NOT NULL, candidate_artifact_id TEXT NOT NULL, artifact_name TEXT NOT NULL, current_revision TEXT NOT NULL, new_revision TEXT NOT NULL, reason TEXT NOT NULL, impact TEXT NOT NULL, requester TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS releases_product_idx ON releases(product_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS releases_version_lookup_idx ON releases(product_id, version, build_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS artifacts_release_idx ON artifacts(release_id, active)"),
    db.prepare("CREATE INDEX IF NOT EXISTS replacements_status_idx ON replacement_requests(status, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', last_login_at TEXT, created_at TEXT NOT NULL, password_hash TEXT, password_salt TEXT, must_change_password INTEGER NOT NULL DEFAULT 0, can_create_products INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS product_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, product_id TEXT NOT NULL, UNIQUE(user_email, product_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS protocol_files (id TEXT PRIMARY KEY, protocol_id TEXT NOT NULL, product_id TEXT NOT NULL, file_name TEXT NOT NULL, object_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS release_requests (id TEXT PRIMARY KEY, release_id TEXT NOT NULL, product_id TEXT NOT NULL, summary TEXT NOT NULL, verification TEXT NOT NULL, requester TEXT NOT NULL, requester_email TEXT, status TEXT NOT NULL, priority TEXT NOT NULL DEFAULT '普通', expected_at TEXT, created_at TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, assigned_tester_email TEXT, claimed_at TEXT, test_result TEXT, test_notes TEXT, tested_by TEXT, tested_at TEXT, review_comment TEXT, first_reviewed_by TEXT, first_reviewed_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS hardware_variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, code TEXT NOT NULL, mcu TEXT NOT NULL, flash_size TEXT NOT NULL, ram_size TEXT NOT NULL, pcb_version TEXT NOT NULL, min_bootloader TEXT NOT NULL, interfaces TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(product_id, code))"),
    db.prepare("CREATE TABLE IF NOT EXISTS product_asset_types (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, asset_type TEXT NOT NULL, UNIQUE(product_id, asset_type))"),
    db.prepare("CREATE TABLE IF NOT EXISTS product_files (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, category TEXT NOT NULL, file_name TEXT NOT NULL, object_key TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, version TEXT NOT NULL DEFAULT '', change_note TEXT NOT NULL DEFAULT '', uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS surplus_materials (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '其他', quantity INTEGER NOT NULL, available_quantity INTEGER NOT NULL, reserved_quantity INTEGER NOT NULL DEFAULT 0, estimated_unit_price REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '可领用', publisher_email TEXT NOT NULL, publisher_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS material_requests (id TEXT PRIMARY KEY, material_id TEXT NOT NULL, requester_email TEXT NOT NULL, requester_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '待确认', created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_email TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS release_requests_status_idx ON release_requests(status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS hardware_variants_product_idx ON hardware_variants(product_id, code)"),
    db.prepare("CREATE INDEX IF NOT EXISTS product_files_product_idx ON product_files(product_id, category, active, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS tool_files_tool_idx ON tool_files(tool_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS tool_product_binding_tool_idx ON tool_product_bindings(tool_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS tool_product_binding_product_idx ON tool_product_bindings(product_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS surplus_materials_status_idx ON surplus_materials(status, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS material_requests_material_idx ON material_requests(material_id, status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS material_requests_requester_idx ON material_requests(requester_email, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS release_hw_binding_idx ON release_hardware_bindings(release_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS release_protocol_binding_idx ON release_protocol_bindings(release_id)"),
  ]);

  // Migrate the original one-tool-to-one-product model to independent tools
  // with optional many-to-many product links. The old columns remain only for
  // backwards-compatible SQLite upgrades and are no longer written.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tool_product_bindings (tool_id, product_id) SELECT id, product_id FROM tools WHERE product_id IS NOT NULL AND product_id <> ''"),
    db.prepare("UPDATE tools SET product_id = NULL WHERE product_id IS NOT NULL"),
    db.prepare("UPDATE tool_files SET product_id = NULL WHERE product_id IS NOT NULL"),
  ]);

  // Historical "approver" accounts become administrators so the released
  // workflow has a single final approval role.
  await db.prepare("UPDATE users SET role = 'admin' WHERE role = 'approver'").run();

  const shareColumns = await db.prepare("PRAGMA table_info(prototype_shares)").all<{ name: string }>();
  const shareColumnNames = new Set(shareColumns.results.map((column) => column.name));
  if (!shareColumnNames.has("token")) await db.prepare("ALTER TABLE prototype_shares ADD COLUMN token TEXT").run();

  const userColumns = await db.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  const columnNames = new Set(userColumns.results.map((column) => column.name));
  if (!columnNames.has("status")) await db.prepare("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run();
  if (!columnNames.has("last_login_at")) await db.prepare("ALTER TABLE users ADD COLUMN last_login_at TEXT").run();
  if (!columnNames.has("password_hash")) await db.prepare("ALTER TABLE users ADD COLUMN password_hash TEXT").run();
  if (!columnNames.has("password_salt")) await db.prepare("ALTER TABLE users ADD COLUMN password_salt TEXT").run();
  if (!columnNames.has("must_change_password")) await db.prepare("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0").run();
  if (!columnNames.has("can_create_products")) await db.prepare("ALTER TABLE users ADD COLUMN can_create_products INTEGER NOT NULL DEFAULT 0").run();

  const productColumns = await db.prepare("PRAGMA table_info(products)").all<{ name: string }>();
  const productColumnNames = new Set(productColumns.results.map((column) => column.name));
  if (!productColumnNames.has("owner_email")) await db.prepare("ALTER TABLE products ADD COLUMN owner_email TEXT").run();
  if (!productColumnNames.has("archived_at")) await db.prepare("ALTER TABLE products ADD COLUMN archived_at TEXT").run();
  if (!productColumnNames.has("archived_by")) await db.prepare("ALTER TABLE products ADD COLUMN archived_by TEXT").run();
  if (!productColumnNames.has("archived_status")) await db.prepare("ALTER TABLE products ADD COLUMN archived_status TEXT").run();
  await db.prepare("UPDATE products SET owner_email = (SELECT email FROM users WHERE lower(trim(display_name)) = lower(trim(products.owner)) LIMIT 1) WHERE owner_email IS NULL OR owner_email = ''").run();
  await db.prepare("UPDATE users SET can_create_products = 1 WHERE lower(email) IN (SELECT lower(owner_email) FROM products WHERE owner_email IS NOT NULL AND owner_email <> '')").run();
  await db.prepare("INSERT OR IGNORE INTO product_permissions (user_email, product_id) SELECT owner_email, id FROM products WHERE owner_email IS NOT NULL AND owner_email <> ''").run();

  const productFileColumns = await db.prepare("PRAGMA table_info(product_files)").all<{ name: string }>();
  const productFileColumnNames = new Set(productFileColumns.results.map((column) => column.name));
  if (!productFileColumnNames.has("version")) await db.prepare("ALTER TABLE product_files ADD COLUMN version TEXT NOT NULL DEFAULT ''").run();
  if (!productFileColumnNames.has("change_note")) await db.prepare("ALTER TABLE product_files ADD COLUMN change_note TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("UPDATE product_files SET version = 'V1.0' WHERE version IS NULL OR version = ''").run();

  const materialColumns = await db.prepare("PRAGMA table_info(surplus_materials)").all<{ name: string }>();
  const materialColumnNames = new Set(materialColumns.results.map((column) => column.name));
  if (!materialColumnNames.has("estimated_unit_price")) await db.prepare("ALTER TABLE surplus_materials ADD COLUMN estimated_unit_price REAL NOT NULL DEFAULT 0").run();
  if (!materialColumnNames.has("reserved_quantity")) await db.prepare("ALTER TABLE surplus_materials ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0").run();
  await db.prepare("UPDATE surplus_materials SET reserved_quantity = 0 WHERE reserved_quantity IS NULL OR reserved_quantity < 0").run();

  const materialRequestColumns = await db.prepare("PRAGMA table_info(material_requests)").all<{ name: string }>();
  const materialRequestColumnNames = new Set(materialRequestColumns.results.map((column) => column.name));
  if (!materialRequestColumnNames.has("unit_price")) await db.prepare("ALTER TABLE material_requests ADD COLUMN unit_price REAL").run();

  const releaseColumns = await db.prepare("PRAGMA table_info(releases)").all<{ name: string }>();
  const releaseColumnNames = new Set(releaseColumns.results.map((column) => column.name));
  if (!releaseColumnNames.has("min_upgrade_version")) await db.prepare("ALTER TABLE releases ADD COLUMN min_upgrade_version TEXT NOT NULL DEFAULT ''").run();
  if (!releaseColumnNames.has("allow_downgrade")) await db.prepare("ALTER TABLE releases ADD COLUMN allow_downgrade INTEGER NOT NULL DEFAULT 0").run();
  if (!releaseColumnNames.has("release_notes")) await db.prepare("ALTER TABLE releases ADD COLUMN release_notes TEXT NOT NULL DEFAULT ''").run();
  if (!releaseColumnNames.has("known_issues")) await db.prepare("ALTER TABLE releases ADD COLUMN known_issues TEXT NOT NULL DEFAULT ''").run();
  if (!releaseColumnNames.has("expected_kinds")) await db.prepare("ALTER TABLE releases ADD COLUMN expected_kinds TEXT NOT NULL DEFAULT ''").run();
  if (!releaseColumnNames.has("trial_member_emails")) await db.prepare("ALTER TABLE releases ADD COLUMN trial_member_emails TEXT NOT NULL DEFAULT '[]'").run();
  if (!releaseColumnNames.has("updated_at")) await db.prepare("ALTER TABLE releases ADD COLUMN updated_at TEXT").run();
  await db.prepare("UPDATE releases SET updated_at = COALESCE(updated_at, (SELECT MAX(created_at) FROM artifacts WHERE artifacts.release_id = releases.id), release_date) WHERE updated_at IS NULL OR updated_at = ''").run();
  await db.prepare("UPDATE releases SET channel = CASE channel WHEN 'Stable' THEN '正式发布' WHEN 'Dev' THEN '开发验证' WHEN 'Beta' THEN '开发验证' WHEN 'RC' THEN '开发验证' ELSE channel END WHERE channel IN ('Stable', 'Dev', 'Beta', 'RC')").run();

  const releaseRequestColumns = await db.prepare("PRAGMA table_info(release_requests)").all<{ name: string }>();
  const releaseRequestColumnNames = new Set(releaseRequestColumns.results.map((column) => column.name));
  if (!releaseRequestColumnNames.has("test_result")) await db.prepare("ALTER TABLE release_requests ADD COLUMN test_result TEXT").run();
  if (!releaseRequestColumnNames.has("tested_by")) await db.prepare("ALTER TABLE release_requests ADD COLUMN tested_by TEXT").run();
  if (!releaseRequestColumnNames.has("tested_at")) await db.prepare("ALTER TABLE release_requests ADD COLUMN tested_at TEXT").run();
  if (!releaseRequestColumnNames.has("assigned_tester_email")) await db.prepare("ALTER TABLE release_requests ADD COLUMN assigned_tester_email TEXT").run();
  if (!releaseRequestColumnNames.has("requester_email")) await db.prepare("ALTER TABLE release_requests ADD COLUMN requester_email TEXT").run();
  if (!releaseRequestColumnNames.has("priority")) await db.prepare("ALTER TABLE release_requests ADD COLUMN priority TEXT NOT NULL DEFAULT '普通'").run();
  if (!releaseRequestColumnNames.has("expected_at")) await db.prepare("ALTER TABLE release_requests ADD COLUMN expected_at TEXT").run();
  if (!releaseRequestColumnNames.has("claimed_at")) await db.prepare("ALTER TABLE release_requests ADD COLUMN claimed_at TEXT").run();
  if (!releaseRequestColumnNames.has("test_notes")) await db.prepare("ALTER TABLE release_requests ADD COLUMN test_notes TEXT").run();
  if (!releaseRequestColumnNames.has("review_comment")) await db.prepare("ALTER TABLE release_requests ADD COLUMN review_comment TEXT").run();
  if (!releaseRequestColumnNames.has("first_reviewed_by")) await db.prepare("ALTER TABLE release_requests ADD COLUMN first_reviewed_by TEXT").run();
  if (!releaseRequestColumnNames.has("first_reviewed_at")) await db.prepare("ALTER TABLE release_requests ADD COLUMN first_reviewed_at TEXT").run();

  const artifactColumns = await db.prepare("PRAGMA table_info(artifacts)").all<{ name: string }>();
  const artifactColumnNames = new Set(artifactColumns.results.map((column) => column.name));
  if (!artifactColumnNames.has("release_request_id")) await db.prepare("ALTER TABLE artifacts ADD COLUMN release_request_id TEXT").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS artifacts_release_request_idx ON artifacts(release_request_id, kind)").run();
  await db.prepare("UPDATE artifacts SET release_request_id = (SELECT release_requests.id FROM release_requests WHERE release_requests.release_id = artifacts.release_id AND release_requests.tested_at = artifacts.created_at LIMIT 1) WHERE kind = '测试报告' AND release_request_id IS NULL").run();
  await db.batch([
    db.prepare("UPDATE release_requests SET status = '测试中', claimed_at = COALESCE(claimed_at, created_at) WHERE status = '待测试' AND assigned_tester_email IS NOT NULL"),
    db.prepare("UPDATE release_requests SET status = '待领取' WHERE status = '待测试' AND assigned_tester_email IS NULL"),
    db.prepare("UPDATE release_requests SET status = '待审核' WHERE status = '待审批'"),
    db.prepare("UPDATE releases SET status = '测试中' WHERE id IN (SELECT release_id FROM release_requests WHERE status = '测试中')"),
    db.prepare("UPDATE releases SET status = '待领取' WHERE id IN (SELECT release_id FROM release_requests WHERE status = '待领取')"),
    db.prepare("UPDATE releases SET status = '待审核' WHERE id IN (SELECT release_id FROM release_requests WHERE status = '待审核')"),
    db.prepare("UPDATE artifacts SET status = '测试中' WHERE release_id IN (SELECT release_id FROM release_requests WHERE status = '测试中') AND active = 0 AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')"),
    db.prepare("UPDATE artifacts SET status = '待领取' WHERE release_id IN (SELECT release_id FROM release_requests WHERE status = '待领取') AND active = 0 AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')"),
    db.prepare("UPDATE artifacts SET status = '待审核' WHERE release_id IN (SELECT release_id FROM release_requests WHERE status = '待审核') AND active = 0 AND kind <> '测试报告' AND status NOT IN ('已替换', '已替代', '已驳回', '候选')"),
  ]);

  const demoCleanup = await db.prepare("SELECT value FROM settings WHERE key = 'demo_cleanup_v1'").first<{ value: string }>();
  if (!demoCleanup) {
    await db.batch([
      db.prepare("DELETE FROM replacement_requests WHERE id = 'rep-001'"),
      db.prepare("DELETE FROM release_requests WHERE id = 'pub-001'"),
      db.prepare("DELETE FROM protocol_files WHERE protocol_id IN ('pro-1','pro-2','pro-3','pro-4')"),
      db.prepare("DELETE FROM artifacts WHERE id IN ('art-a100-app','art-a100-boot','art-a100-flash','art-a100-app-r2')"),
      db.prepare("DELETE FROM protocols WHERE id IN ('pro-1','pro-2','pro-3','pro-4')"),
      db.prepare("DELETE FROM tools WHERE id IN ('tool-1','tool-2','tool-3')"),
      db.prepare("DELETE FROM releases WHERE id IN ('rel-a100-241','rel-s200-183','rel-g400-310')"),
      db.prepare("DELETE FROM product_permissions WHERE user_email IN ('li.ming@example.internal','wang.fang@example.internal','zhou.qi@example.internal') OR product_id IN ('p-a100','p-s200','p-g400','p-h100')"),
      db.prepare("DELETE FROM product_asset_types WHERE product_id IN ('p-a100','p-s200','p-g400','p-h100')"),
      db.prepare("DELETE FROM hardware_variants WHERE product_id IN ('p-a100','p-s200','p-g400','p-h100')"),
      db.prepare("DELETE FROM products WHERE id IN ('p-a100','p-s200','p-g400','p-h100')"),
      db.prepare("DELETE FROM users WHERE email IN ('li.ming@example.internal','wang.fang@example.internal','zhou.qi@example.internal')"),
      db.prepare("INSERT INTO settings (key, value) VALUES ('demo_cleanup_v1', 'completed')"),
    ]);
  }
}

export async function writeAudit(actorEmail: string, action: string, resourceType: string, resourceId: string, detail: string) {
  await getD1().prepare("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?)").bind(`audit-${crypto.randomUUID()}`, actorEmail, action, resourceType, resourceId, detail, new Date().toISOString()).run();
  if (!action.endsWith(".download") && action !== "material.ai_bom_match") publishRealtimeEvent(action, resourceType, resourceId);
}

export function sha256Hex(buffer: BufferSource) {
  return crypto.subtle.digest("SHA-256", buffer).then((hash) => Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}
