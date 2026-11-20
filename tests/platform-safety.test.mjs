import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("controlled product files enforce product collaboration on the server", async () => {
  const [storage, artifactDownload, productFileDownload, protocolFileDownload, toolDownload] = await Promise.all([
    source("lib/storage.ts"),
    source("app/api/artifacts/[id]/download/route.ts"),
    source("app/api/products/files/[id]/download/route.ts"),
    source("app/api/protocols/files/[id]/download/route.ts"),
    source("app/api/tools/files/[id]/download/route.ts"),
  ]);

  assert.match(storage, /export async function requireProductCollaboration/);
  assert.match(artifactDownload, /const isCollaborator = access\.isAdmin/);
  assert.match(artifactDownload, /assigned_tester_email/);
  assert.match(productFileDownload, /const access = await requireProductCollaboration\(request, file\.product_id\)/);
  assert.match(protocolFileDownload, /const access = await requireProductCollaboration\(request, file\.product_id\)/);
  assert.match(toolDownload, /SELECT product_id FROM tool_product_bindings/);
  assert.match(toolDownload, /您没有该产品工具的下载权限/);
});

test("controlled downloads and firmware uploads leave audit records", async () => {
  const [artifacts, artifactDownload, productFileDownload, protocolFileDownload, toolDownload] = await Promise.all([
    source("app/api/artifacts/route.ts"),
    source("app/api/artifacts/[id]/download/route.ts"),
    source("app/api/products/files/[id]/download/route.ts"),
    source("app/api/protocols/files/[id]/download/route.ts"),
    source("app/api/tools/files/[id]/download/route.ts"),
  ]);

  assert.match(artifacts, /writeAudit\(access\.email, replaceArtifactId \? "artifact\.replace_draft" : "artifact\.upload"/);
  assert.match(artifactDownload, /"artifact\.download"/);
  assert.match(productFileDownload, /"product_file\.download"/);
  assert.match(protocolFileDownload, /"protocol_file\.download"/);
  assert.match(toolDownload, /"tool_file\.download"/);
});

test("firmware upload rejects duplicate file slots and wrong flashing format", async () => {
  const [artifacts, artifactItem, hub] = await Promise.all([
    source("app/api/artifacts/route.ts"),
    source("app/api/artifacts/[id]/route.ts"),
    source("app/FirmwareHub.tsx"),
  ]);

  assert.match(artifacts, /replaceArtifactId/);
  assert.match(artifacts, /kind !== "线刷包"/);
  assert.match(artifactItem, /release\.status !== "草稿"/);
  assert.match(hub, /替换/);
});

test("non-empty products are archived instead of physically removed", async () => {
  const [storage, productRoute, restoreRoute, catalog] = await Promise.all([
    source("lib/storage.ts"),
    source("app/api/products/[id]/route.ts"),
    source("app/api/products/[id]/restore/route.ts"),
    source("app/api/catalog/route.ts"),
  ]);

  assert.match(storage, /archived_at TEXT/);
  assert.match(productRoute, /product\.archive/);
  assert.match(productRoute, /archived_status = status/);
  assert.match(restoreRoute, /product\.restore/);
  assert.match(catalog, /WHERE archived_at IS NULL/);
});

test("material requests reserve quantity and can be cancelled", async () => {
  const [storage, materials, requests, decisions, hub] = await Promise.all([
    source("lib/storage.ts"),
    source("app/api/materials/[id]/route.ts"),
    source("app/api/material-requests/route.ts"),
    source("app/api/material-requests/[id]/route.ts"),
    source("app/FirmwareHub.tsx"),
  ]);

  assert.match(storage, /reserved_quantity INTEGER NOT NULL DEFAULT 0/);
  assert.match(requests, /reserved_quantity = reserved_quantity \+ \?/);
  assert.match(requests, /可申请数量已被其他同事预留/);
  assert.match(decisions, /action === "cancel"/);
  assert.match(decisions, /reserved_quantity = MAX\(reserved_quantity - \?, 0\)/);
  assert.match(materials, /quantity < material\.reserved_quantity/);
  assert.match(hub, /onCancel=\{cancelMaterialRequest\}/);
});

test("database initialization is shared within a running service", async () => {
  const storage = await source("lib/storage.ts");
  assert.match(storage, /let ensurePromise: Promise<void> \| null = null/);
  assert.match(storage, /ensurePromise = runEnsureAndSeed\(\)/);
});

test("all active signed-in users can edit release known issues", async () => {
  const [knownIssuesRoute, hub] = await Promise.all([
    source("app/api/releases/[id]/known-issues/route.ts"),
    source("app/FirmwareHub.tsx"),
  ]);

  assert.match(knownIssuesRoute, /requireAccess\(request, "viewer"\)/);
  assert.doesNotMatch(knownIssuesRoute, /requireAccess\(request, "developer"/);
  assert.match(hub, /<button className="btn small ghost" disabled=\{busy\} onClick=\{\(\) => onEditKnownIssues\(release\)\}>编辑已知问题<\/button>/);
  assert.doesNotMatch(hub, /\{canUpload && <button[^>]*onClick=\{\(\) => onEditKnownIssues\(release\)\}/);
});

test("test reports stay attached to their own release request", async () => {
  const [storage, releaseRequests, hub] = await Promise.all([
    source("lib/storage.ts"),
    source("app/api/release-requests/[id]/route.ts"),
    source("app/FirmwareHub.tsx"),
  ]);

  assert.match(storage, /release_request_id TEXT/);
  assert.match(storage, /release_requests\.tested_at = artifacts\.created_at/);
  assert.match(releaseRequests, /created_at, release_request_id\) VALUES/);
  assert.match(releaseRequests, /access\.displayName, now, id\)\)/);
  assert.equal((hub.match(/artifact\.releaseRequestId === item\.id/g) ?? []).length, 2);
});

test("catalog changes stream to open pages and trigger automatic refresh", async () => {
  const [eventsRoute, realtime, storage, hub] = await Promise.all([
    source("app/api/events/route.ts"),
    source("lib/realtime.ts"),
    source("lib/storage.ts"),
    source("app/FirmwareHub.tsx"),
  ]);

  assert.match(eventsRoute, /text\/event-stream/);
  assert.match(eventsRoute, /X-Accel-Buffering/);
  assert.match(realtime, /subscribeRealtimeEvents/);
  assert.match(storage, /publishRealtimeEvent\(action, resourceType, resourceId\)/);
  assert.match(hub, /consumeCatalogEvents\(synchronize, realtime\.signal\)/);
  assert.match(hub, /window\.setInterval\(synchronize, 30_000\)/);
  assert.match(hub, /收到 \$\{newApprovals\.length\} 个新的审批任务/);
  assert.match(hub, /className="realtime-toast"/);
});

test("self-hosted authentication is isolated per browser tab", async () => {
  const [clientAuth, auth, storage, proxy, login, changePassword, hub] = await Promise.all([
    source("lib/client-auth.ts"),
    source("lib/selfhost-auth.ts"),
    source("lib/storage.ts"),
    source("proxy.ts"),
    source("app/api/auth/login/route.ts"),
    source("app/api/auth/change-password/route.ts"),
    source("app/FirmwareHub.tsx"),
  ]);

  assert.match(clientAuth, /window\.sessionStorage\.setItem\(TAB_SESSION_KEY, token\)/);
  assert.match(clientAuth, /headers\.set\("Authorization", `Bearer \$\{token\}`\)/);
  assert.match(clientAuth, /downloadWithAuth/);
  assert.match(clientAuth, /consumeCatalogEvents/);
  assert.match(auth, /authorization\?\.toLowerCase\(\)\.startsWith\("bearer "\)/);
  assert.doesNotMatch(auth, /request\.headers\.get\("cookie"\)/);
  assert.match(storage, /verifySession\(sessionTokenFromRequest\(request\)\)/);
  assert.match(proxy, /pathname === "\/"/);
  assert.match(login, /mustChangePassword, token/);
  assert.match(changePassword, /ok: true, token/);
  assert.match(hub, /clearTabSession\(\)/);
});

test("material requests notify publishers and requesters in realtime", async () => {
  const hub = await source("app/FirmwareHub.tsx");
  assert.match(hub, /pendingMaterialRequestIds/);
  assert.match(hub, /resolvedMaterialRequests/);
  assert.match(hub, /新的物料领用申请/);
  assert.match(hub, /物料领用申请有新结果/);
  assert.match(hub, /"materials", newMaterialRequests\.length/);
});

test("realtime notices provide persistent strong in-page alerts", async () => {
  const [hub, css] = await Promise.all([source("app/FirmwareHub.tsx"), source("app/globals.css")]);
  assert.match(hub, /function playAlertSound/);
  assert.match(hub, /new AudioContext\(\)/);
  assert.match(hub, /document\.title = `【新提醒】/);
  assert.match(hub, /unreadNotices/);
  assert.match(hub, /未处理前会持续提示/);
  assert.doesNotMatch(hub, /setTimeout\(\(\) => setRealtimeNotice\(null\), 8000\)/);
  assert.match(css, /realtime-toast-attention/);
});
