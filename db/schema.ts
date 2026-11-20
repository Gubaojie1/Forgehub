import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(), code: text("code").notNull().unique(), name: text("name").notNull(), family: text("family").notNull(),
  hwVersions: text("hw_versions").notNull(), owner: text("owner").notNull(), status: text("status").notNull(), description: text("description").notNull(),
});

export const releases = sqliteTable("releases", {
  id: text("id").primaryKey(), productId: text("product_id").notNull(), version: text("version").notNull(), buildNumber: text("build_number").notNull(),
  channel: text("channel").notNull(), status: text("status").notNull(), bootloaderVersion: text("bootloader_version").notNull(), appVersion: text("app_version").notNull(),
  protocolSummary: text("protocol_summary").notNull(), releaseDate: text("release_date").notNull(), artifactCount: integer("artifact_count").notNull().default(0),
  minUpgradeVersion: text("min_upgrade_version").notNull().default(""), allowDowngrade: integer("allow_downgrade").notNull().default(0),
  releaseNotes: text("release_notes").notNull().default(""), knownIssues: text("known_issues").notNull().default(""),
  trialMemberEmails: text("trial_member_emails").notNull().default("[]"),
});

export const releaseHardwareBindings = sqliteTable("release_hardware_bindings", {
  id: integer("id").primaryKey({ autoIncrement: true }), releaseId: text("release_id").notNull(), hardwareVariantId: text("hardware_variant_id").notNull(),
});

export const releaseProtocolBindings = sqliteTable("release_protocol_bindings", {
  id: integer("id").primaryKey({ autoIncrement: true }), releaseId: text("release_id").notNull(), protocolId: text("protocol_id").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(), releaseId: text("release_id").notNull(), productId: text("product_id").notNull(), kind: text("kind").notNull(), name: text("name").notNull(),
  revision: text("revision").notNull(), objectKey: text("object_key").notNull(), size: integer("size").notNull(), sha256: text("sha256").notNull(), status: text("status").notNull(),
  active: integer("active").notNull().default(0), uploadedBy: text("uploaded_by").notNull(), createdAt: text("created_at").notNull(), releaseRequestId: text("release_request_id"),
});

export const protocols = sqliteTable("protocols", {
  id: text("id").primaryKey(), productId: text("product_id").notNull(), name: text("name").notNull(), version: text("version").notNull(),
  interfaceType: text("interface_type").notNull(), updatedAt: text("updated_at").notNull(), status: text("status").notNull(), description: text("description").notNull(),
});

export const tools = sqliteTable("tools", {
  id: text("id").primaryKey(), productId: text("product_id"), name: text("name").notNull(), version: text("version").notNull(), platform: text("platform").notNull(),
  updatedAt: text("updated_at").notNull(), status: text("status").notNull(), description: text("description").notNull(),
});

export const toolFiles = sqliteTable("tool_files", {
  id: text("id").primaryKey(), toolId: text("tool_id").notNull(), productId: text("product_id"), fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull(), size: integer("size").notNull(), sha256: text("sha256").notNull(), uploadedBy: text("uploaded_by").notNull(), createdAt: text("created_at").notNull(),
});

export const replacementRequests = sqliteTable("replacement_requests", {
  id: text("id").primaryKey(), productId: text("product_id").notNull(), releaseId: text("release_id").notNull(), sourceArtifactId: text("source_artifact_id").notNull(),
  candidateArtifactId: text("candidate_artifact_id").notNull(), artifactName: text("artifact_name").notNull(), currentRevision: text("current_revision").notNull(), newRevision: text("new_revision").notNull(),
  reason: text("reason").notNull(), impact: text("impact").notNull(), requester: text("requester").notNull(), status: text("status").notNull(), createdAt: text("created_at").notNull(),
  reviewedBy: text("reviewed_by"), reviewedAt: text("reviewed_at"),
});

export const users = sqliteTable("users", {
  email: text("email").primaryKey(), displayName: text("display_name").notNull(), role: text("role").notNull(), status: text("status").notNull().default("active"), lastLoginAt: text("last_login_at"), createdAt: text("created_at").notNull(),
  passwordHash: text("password_hash"), passwordSalt: text("password_salt"), mustChangePassword: integer("must_change_password").notNull().default(0),
});

export const productPermissions = sqliteTable("product_permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }), userEmail: text("user_email").notNull(), productId: text("product_id").notNull(),
});

export const protocolFiles = sqliteTable("protocol_files", {
  id: text("id").primaryKey(), protocolId: text("protocol_id").notNull(), productId: text("product_id").notNull(), fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull(), size: integer("size").notNull(), sha256: text("sha256").notNull(), uploadedBy: text("uploaded_by").notNull(), createdAt: text("created_at").notNull(),
});

export const releaseRequests = sqliteTable("release_requests", {
  id: text("id").primaryKey(), releaseId: text("release_id").notNull(), productId: text("product_id").notNull(), summary: text("summary").notNull(),
  verification: text("verification").notNull(), requester: text("requester").notNull(), requesterEmail: text("requester_email"), status: text("status").notNull(),
  priority: text("priority").notNull().default("普通"), expectedAt: text("expected_at"), createdAt: text("created_at").notNull(),
  reviewedBy: text("reviewed_by"), reviewedAt: text("reviewed_at"), assignedTesterEmail: text("assigned_tester_email"), claimedAt: text("claimed_at"),
  testResult: text("test_result"), testNotes: text("test_notes"), testedBy: text("tested_by"), testedAt: text("tested_at"), reviewComment: text("review_comment"),
  firstReviewedBy: text("first_reviewed_by"), firstReviewedAt: text("first_reviewed_at"),
});

export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: text("value").notNull() });

export const hardwareVariants = sqliteTable("hardware_variants", {
  id: text("id").primaryKey(), productId: text("product_id").notNull(), code: text("code").notNull(), mcu: text("mcu").notNull(), flashSize: text("flash_size").notNull(),
  ramSize: text("ram_size").notNull(), pcbVersion: text("pcb_version").notNull(), minBootloader: text("min_bootloader").notNull(), interfaces: text("interfaces").notNull(), createdAt: text("created_at").notNull(),
});

export const productAssetTypes = sqliteTable("product_asset_types", {
  id: integer("id").primaryKey({ autoIncrement: true }), productId: text("product_id").notNull(), assetType: text("asset_type").notNull(),
});

export const productFiles = sqliteTable("product_files", {
  id: text("id").primaryKey(), productId: text("product_id").notNull(), category: text("category").notNull(), fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull(), size: integer("size").notNull(), sha256: text("sha256").notNull(), active: integer("active").notNull().default(1),
  uploadedBy: text("uploaded_by").notNull(), createdAt: text("created_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), actorEmail: text("actor_email").notNull(), action: text("action").notNull(), resourceType: text("resource_type").notNull(), resourceId: text("resource_id").notNull(), detail: text("detail").notNull(), createdAt: text("created_at").notNull(),
});

export const surplusMaterials = sqliteTable("surplus_materials", {
  id: text("id").primaryKey(), name: text("name").notNull(), category: text("category").notNull().default("其他"),
  quantity: integer("quantity").notNull(), availableQuantity: integer("available_quantity").notNull(), reservedQuantity: integer("reserved_quantity").notNull().default(0), note: text("note").notNull().default(""),
  status: text("status").notNull().default("可领用"), publisherEmail: text("publisher_email").notNull(), publisherName: text("publisher_name").notNull(),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});

export const materialRequests = sqliteTable("material_requests", {
  id: text("id").primaryKey(), materialId: text("material_id").notNull(), requesterEmail: text("requester_email").notNull(), requesterName: text("requester_name").notNull(),
  quantity: integer("quantity").notNull(), note: text("note").notNull().default(""), status: text("status").notNull().default("待确认"),
  createdAt: text("created_at").notNull(), resolvedAt: text("resolved_at"), resolvedBy: text("resolved_by"),
});
