"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { PrototypeWorkspace } from "./PrototypeWorkspace";
import { Lcsc3DDownloader } from "./Lcsc3DDownloader";
import { authFetch, clearTabSession, consumeCatalogEvents, downloadWithAuth } from "@/lib/client-auth";

type Product = { id: string; code: string; name: string; family: string; hwVersions: string; owner: string; ownerEmail?: string | null; status: string; description: string };
type Release = { id: string; productId: string; version: string; buildNumber: string; channel: string; status: string; bootloaderVersion: string; appVersion: string; protocolSummary: string; releaseDate: string; updatedAt?: string | null; artifactCount: number; minUpgradeVersion: string; allowDowngrade: number; releaseNotes: string; knownIssues: string; trialMemberEmails?: string | null; expectedKinds?: string | null; hardwareScope?: string | null; hardwareVariantIds?: string | null; protocolBindings?: string | null; protocolIds?: string | null };
type Protocol = { id: string; productId: string; name: string; version: string; interfaceType: string; updatedAt: string; status: string; description: string };
type Tool = { id: string; productId: string | null; productIds?: string | null; productScope?: string | null; name: string; version: string; platform: string; updatedAt: string; status: string; description: string };
type ToolFile = { id: string; toolId: string; productId: string | null; fileName: string; size: number; sha256: string; uploadedBy: string; createdAt: string };
type Artifact = { id: string; releaseId: string; productId: string; kind: string; name: string; revision: string; size: number; sha256: string; status: string; active: number; uploadedBy: string; createdAt: string; releaseRequestId?: string | null };
type Replacement = { id: string; productId: string; releaseId: string; artifactName: string; currentRevision: string; newRevision: string; reason: string; impact: string; requester: string; status: string; createdAt: string; productName?: string; releaseVersion?: string };
type ReleaseRequest = { id: string; releaseId: string; productId: string; summary: string; verification: string; requester: string; requesterEmail?: string | null; status: string; priority?: string; expectedAt?: string | null; createdAt: string; assignedTesterEmail?: string | null; assignedTesterName?: string | null; claimedAt?: string | null; testResult?: string | null; testNotes?: string | null; testedBy?: string | null; testedAt?: string | null; reviewComment?: string | null; firstReviewedBy?: string | null; firstReviewedAt?: string | null; reviewedBy?: string | null; reviewedAt?: string | null; productName?: string; releaseVersion?: string };
type Member = { email: string; displayName: string; role: "viewer" | "developer" | "tester" | "product_owner" | "project_manager" | "admin"; status: "active" | "disabled"; productScope?: string | null; productIds?: string | null; lastLoginAt?: string | null; mustChangePassword?: number; canCreateProducts?: number };
type OwnerCandidate = { email: string; displayName: string };
type TesterOption = { email: string; displayName: string };
type ProtocolFile = { id: string; protocolId: string; productId: string; fileName: string; size: number; sha256: string; uploadedBy: string; createdAt: string };
type HardwareVariant = { id: string; productId: string; code: string; mcu: string; flashSize: string; ramSize: string; pcbVersion: string; minBootloader: string; interfaces: string; createdAt: string };
type AssetType = { id: number; productId: string; assetType: string };
type ProductFile = { id: string; productId: string; category: "hardware_package" | "project_charter" | "requirements"; fileName: string; size: number; sha256: string; active: number; version: string; changeNote: string; uploadedBy: string; createdAt: string };
type AuditLog = { id: string; actorEmail: string; action: string; resourceType: string; resourceId: string; detail: string; createdAt: string };
type Material = { id: string; name: string; category: string; quantity: number; availableQuantity: number; reservedQuantity: number; estimatedUnitPrice: number; note: string; status: "可领用" | "已领完" | "已下架"; publisherEmail: string; publisherName: string; createdAt: string; updatedAt: string };
type MaterialRequest = { id: string; materialId: string; requesterEmail: string; requesterName: string; quantity: number; note: string; status: "待确认" | "已同意" | "已拒绝" | "已撤销"; createdAt: string; resolvedAt?: string | null; resolvedBy?: string | null; materialName: string; publisherEmail: string; publisherName: string };
type BomSuggestion = { materialId: string; name: string; category: string; availableQuantity: number; publisherName: string; note: string; score: number; level: "推荐" | "疑似"; reason?: string };
type BomMatchRow = { name: string; quantity: number | null; suggestions: BomSuggestion[] };
type CurrentUser = { email: string; displayName: string; role: Member["role"]; status: string; productIds: string[]; ownedProductIds: string[]; isSystemOwner: boolean; isAdmin: boolean; canCreateProduct: boolean; canUpload: boolean; canTest: boolean; canApprove: boolean };
type Catalog = { products: Product[]; releases: Release[]; protocols: Protocol[]; tools: Tool[]; toolFiles: ToolFile[]; artifacts: Artifact[]; replacements: Replacement[]; releaseRequests: ReleaseRequest[]; materials: Material[]; materialRequests: MaterialRequest[]; materialStats: { sharedQuantity: number; savedCost: number }; users: Member[]; ownerCandidates: OwnerCandidate[]; testers: TesterOption[]; protocolFiles: ProtocolFile[]; hardwareVariants: HardwareVariant[]; assetTypes: AssetType[]; productFiles: ProductFile[]; auditLogs: AuditLog[]; uploadMaxMb: number; currentUser: CurrentUser };

const fallback: Catalog = {
  products: [], releases: [], protocols: [], tools: [], toolFiles: [], artifacts: [], replacements: [], releaseRequests: [], materials: [], materialRequests: [], materialStats: { sharedQuantity: 0, savedCost: 0 }, users: [], ownerCandidates: [], testers: [], protocolFiles: [], hardwareVariants: [], assetTypes: [], productFiles: [], auditLogs: [], uploadMaxMb: 200,
  currentUser: { email: "", displayName: "", role: "viewer", status: "active", productIds: [], ownedProductIds: [], isSystemOwner: false, isAdmin: false, canCreateProduct: false, canUpload: false, canTest: false, canApprove: false },
};

function firmwareFileIssue(kind: string, fileName: string) {
  const name = fileName.toLowerCase();
  if (kind !== "线刷包" && name.endsWith(".hex")) return "检测到 .hex 文件：它属于线刷包，请在“线刷包”栏位上传";
  return null;
}

const navItems = [
  ["dashboard", "总览", "总"], ["products", "产品管理", "产"], ["tools", "工具管理", "工"], ["lcsc-3d", "立创3D下载", "3D"], ["materials", "研发物料", "料"], ["testing", "测试工作台", "测"], ["approvals", "审批中心", "审"], ["members", "成员权限", "权"],
];

type WorkflowAction = "claim" | "unclaim" | "pass" | "fail" | "approve" | "reject";
type WorkflowDecision = { id: string; action: Exclude<WorkflowAction, "claim" | "unclaim">; kind: "replacement" | "release" };
type RealtimeView = "approvals" | "testing" | "materials";

function formatSize(value: number) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatShortDateTime(value?: string | null) {
  if (!value) return "尚未登录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace("T", " ");
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatUpdateTime(value?: string | null) {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return formatDateTime(value);
}

function formatCurrency(value?: number | null) {
  const amount = Number(value ?? 0);
  return amount > 0 ? `¥${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : "—";
}

function formatAuditDetail(value: string) {
  return value.replace(/（SHA-256[^）]*）/g, "").replace(/\s{2,}/g, " ").trim();
}

function roleLabel(role: Member["role"]) {
  return ({ viewer: "只读用户", developer: "开发人员", tester: "测试工程师", product_owner: "产品负责人", project_manager: "项目经理", admin: "管理员" })[role];
}

function startDownload(url: string, fileName: string) { return downloadWithAuth(url, fileName); }

function playAlertSound() {
  try {
    const context = new AudioContext();
    void context.resume().then(() => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.setValueAtTime(1046, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.38);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.4);
      oscillator.addEventListener("ended", () => { void context.close(); }, { once: true });
    }).catch(() => { void context.close(); });
  } catch { /* The visual alert still works when audio is unavailable. */ }
}

function pendingApprovalIds(value: Catalog) {
  return new Set([
    ...value.replacements.filter((item) => item.status === "待审批").map((item) => `replacement:${item.id}`),
    ...value.releaseRequests.filter((item) => ["待审核", "待终审"].includes(item.status)).map((item) => `release:${item.id}`),
  ]);
}

function pendingTestIds(value: Catalog) {
  return new Set(value.releaseRequests.filter((item) => item.status === "待领取").map((item) => item.id));
}

function pendingMaterialRequestIds(value: Catalog, email: string) {
  const normalizedEmail = email.toLowerCase();
  return new Set(value.materialRequests
    .filter((item) => item.status === "待确认" && item.publisherEmail.toLowerCase() === normalizedEmail)
    .map((item) => item.id));
}

function resolvedMaterialRequests(previous: Catalog, next: Catalog, email: string) {
  const normalizedEmail = email.toLowerCase();
  const previousById = new Map(previous.materialRequests.map((item) => [item.id, item]));
  return next.materialRequests.filter((item) => {
    const old = previousById.get(item.id);
    return item.requesterEmail.toLowerCase() === normalizedEmail
      && old?.status === "待确认"
      && (item.status === "已同意" || item.status === "已拒绝");
  });
}

export function FirmwareHub({ displayName }: { displayName: string }) {
  const [view, setView] = useState("dashboard");
  const [catalog, setCatalog] = useState<Catalog>(fallback);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [testPackageId, setTestPackageId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<"upload" | "replace" | "product" | "editProduct" | "productFile" | "protocol" | "protocolRecord" | "editProtocol" | "release" | "version" | "editVersion" | "tool" | "editTool" | "toolFile" | "member" | "material" | "materialRequest" | "materialEdit" | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedRelease, setSelectedRelease] = useState<Release | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [targetReleaseId, setTargetReleaseId] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<string | null>(null);
  const [productFileCategory, setProductFileCategory] = useState<ProductFile["category"]>("project_charter");
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [realtimeNotices, setRealtimeNotices] = useState<Array<{ message: string; view: RealtimeView }>>([]);
  const realtimeNotice = realtimeNotices[0] ?? null;
  const [unreadNotices, setUnreadNotices] = useState<Record<RealtimeView, number>>({ approvals: 0, testing: 0, materials: 0 });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const catalogRequestId = useRef(0);
  const [workflowDecision, setWorkflowDecision] = useState<WorkflowDecision | null>(null);
  const initialRoleRoute = useRef(false);
  const catalogRef = useRef<Catalog>(fallback);

  function showRealtimeNotice(message: string, view: RealtimeView, count = 1) {
    setRealtimeNotices((current) => [...current, { message, view }]);
    setUnreadNotices((current) => ({ ...current, [view]: current[view] + count }));
    playAlertSound();
  }

  async function loadCatalog(_notify = false) {
    const requestId = ++catalogRequestId.current;
    try {
      const response = await authFetch("/api/catalog", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (requestId !== catalogRequestId.current) return;
      if (response.status === 403 && result.code === "PASSWORD_CHANGE_REQUIRED") { window.location.assign("/change-password"); return; }
      if (!response.ok) throw new Error(result.error ?? "数据加载失败");
      const previous = catalogRef.current;
      if (previous.currentUser.email) {
        // Also notify after our own mutations: that refresh may include other users' events.
        const previousApprovals = pendingApprovalIds(previous);
        const newApprovals = [...pendingApprovalIds(result)].filter((id) => !previousApprovals.has(id));
        const previousTests = pendingTestIds(previous);
        const newTests = [...pendingTestIds(result)].filter((id) => !previousTests.has(id));
        const currentEmail = String(result.currentUser?.email ?? previous.currentUser.email);
        const previousMaterialRequests = pendingMaterialRequestIds(previous, currentEmail);
        const newMaterialRequests = [...pendingMaterialRequestIds(result, currentEmail)].filter((id) => !previousMaterialRequests.has(id));
        const resolvedMaterials = resolvedMaterialRequests(previous, result, currentEmail);
        if (newApprovals.length > 0 && (result.currentUser?.canApprove || result.currentUser?.isAdmin)) {
          showRealtimeNotice(`收到 ${newApprovals.length} 个新的审批任务`, "approvals", newApprovals.length);
        }
        if (newTests.length > 0 && result.currentUser?.canTest) {
          showRealtimeNotice(`收到 ${newTests.length} 个新的测试任务`, "testing", newTests.length);
        }
        if (newMaterialRequests.length > 0) {
          showRealtimeNotice(`收到 ${newMaterialRequests.length} 个新的物料领用申请`, "materials", newMaterialRequests.length);
        }
        if (resolvedMaterials.length > 0) {
          const approved = resolvedMaterials.filter((item) => item.status === "已同意").length;
          const rejected = resolvedMaterials.length - approved;
          const resultText = [approved ? `${approved} 个已同意` : "", rejected ? `${rejected} 个已拒绝` : ""].filter(Boolean).join("，");
          showRealtimeNotice(`物料领用申请有新结果：${resultText}`, "materials", resolvedMaterials.length);
        }
      }
      catalogRef.current = result;
      setCatalog(result); setLoadError(null); setSyncError(null);
      if (!initialRoleRoute.current) {
        initialRoleRoute.current = true;
        if (result.currentUser?.role === "tester") setView("testing");
      }
    } catch (error) {
      if (requestId !== catalogRequestId.current) return;
      const message = error instanceof Error ? error.message : "数据加载失败";
      if (catalogRef.current.currentUser.email) setSyncError(message);
      else setLoadError(message);
    } finally { if (requestId === catalogRequestId.current) setLoading(false); }
  }

  // The first request initializes the current authenticated member and catalog.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadCatalog(); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 3200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!realtimeNotice) return;
    const originalTitle = document.title;
    let highlighted = true;
    document.title = `【新提醒】${originalTitle}`;
    const timer = window.setInterval(() => {
      highlighted = !highlighted;
      document.title = highlighted ? `【新提醒】${originalTitle}` : originalTitle;
    }, 900);
    return () => { window.clearInterval(timer); document.title = originalTitle; };
  }, [realtimeNotice]);
  useEffect(() => {
    const synchronize = () => { void loadCatalog(true); };
    const realtime = new AbortController();
    void consumeCatalogEvents(synchronize, realtime.signal);
    const polling = window.setInterval(synchronize, 30_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") synchronize(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { realtime.abort(); window.clearInterval(polling); document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, []);

  const selectedProduct = catalog.products.find((item) => item.id === selectedProductId) ?? null;
  const productReleases = catalog.releases.filter((item) => item.productId === selectedProductId);
  const latestRelease = productReleases[0];
  const pendingReplacements = catalog.replacements.filter((item) => item.status === "待审批");
  const pendingTests = catalog.releaseRequests.filter((item) => ["待领取", "测试中"].includes(item.status));
  const pendingReleases = catalog.releaseRequests.filter((item) => ["待审核", "待终审"].includes(item.status));
  const pending = pendingReplacements.length + pendingReleases.length;
  const normalized = query.trim().toLowerCase();
  const filteredProducts = useMemo(() => catalog.products.filter((item) => {
    if (!normalized) return true;
    const releaseText = catalog.releases.filter((release) => release.productId === item.id).map((release) => `${release.version} ${release.buildNumber} ${release.bootloaderVersion} ${release.appVersion} ${release.protocolSummary}`).join(" ");
    const protocolText = catalog.protocols.filter((protocol) => protocol.productId === item.id).map((protocol) => `${protocol.name} ${protocol.version} ${protocol.interfaceType}`).join(" ");
    return `${item.code} ${item.name} ${item.family} ${releaseText} ${protocolText}`.toLowerCase().includes(normalized);
  }), [catalog.products, catalog.releases, catalog.protocols, normalized]);

  function go(nextView: string) {
    if (nextView === "members" && !catalog.currentUser.isAdmin) return;
    if (nextView === "approvals" || nextView === "testing" || nextView === "materials") {
      setUnreadNotices((current) => ({ ...current, [nextView]: 0 }));
      setRealtimeNotices((current) => current.filter((notice) => notice.view !== nextView));
    }
    setView(nextView); setSelectedProductId(null); setTestPackageId(null);
  }
  function openProduct(id: string) { setTestPackageId(null); setView("products"); setSelectedProductId(id); }
  function openTestPackage(productId: string, releaseId: string) { setSelectedProductId(productId); setTestPackageId(releaseId); setView("test-package"); }

  async function review(id: string, action: WorkflowAction, kind: "replacement" | "release", note?: string, report?: File | null, scope?: "trial" | "formal", trialMemberEmails: string[] = []) {
    setBusy(true);
    try {
      const useFormData = kind === "release" && (action === "pass" || action === "fail") && Boolean(report);
      const form = new FormData();
      if (useFormData) { form.set("action", action); form.set("note", note ?? ""); if (report) form.set("report", report); }
      const response = await authFetch(kind === "replacement" ? `/api/replacements/${id}` : `/api/release-requests/${id}`, useFormData
        ? { method: "PATCH", body: form }
        : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note, scope, trialMemberEmails }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "审批失败");
      await loadCatalog();
      setWorkflowDecision(null);
      setToast(action === "claim" ? "测试任务已领取" : action === "unclaim" ? "任务已退回测试池" : action === "pass" ? "测试通过，已进入审核" : action === "fail" ? "测试未通过，已退回开发" : action === "approve" ? (kind === "replacement" ? "替换申请已批准" : scope === "trial" ? "已进入小范围试用" : "已正式发布") : "申请已驳回");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "审批失败");
    } finally { setBusy(false); }
  }

  async function updateReleaseStatus(release: Release, status: "草稿" | "开发自测" | "测试中") {
    setBusy(true);
    try {
      const nextStatus = status === "测试中" ? "开发自测" : status;
      const response = await authFetch(`/api/releases/${release.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "状态更新失败");
      await loadCatalog(); setToast(`固件版本已切换为${status}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "状态更新失败"); }
    finally { setBusy(false); }
  }

  async function promoteTrialRelease(release: Release, channel: "小范围试用" | "正式发布" = (release.channel === "正式发布" ? "小范围试用" : "正式发布"), trialMemberEmails: string[] = []) {
    if (channel === "小范围试用" && trialMemberEmails.length === 0) {
      const entered = window.prompt("请输入可查看和下载该版本的同事邮箱，多个邮箱用逗号分隔：", "");
      if (entered === null) return;
      trialMemberEmails = entered.split(/[，,;；\n]/).map((email) => email.trim()).filter(Boolean);
      if (trialMemberEmails.length === 0) { setToast("小范围试用至少需要指定一位同事"); return; }
    }
    if (!window.confirm(`确认将 ${release.version} 改为${channel}吗？`)) return;
    setBusy(true);
    try {
      const response = await authFetch(`/api/releases/${release.id}/scope`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, trialMemberEmails }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "转为正式发布失败");
      await loadCatalog(); setToast("版本已转为正式发布");
    } catch (error) { setToast(error instanceof Error ? error.message : "转为正式发布失败"); }
    finally { setBusy(false); }
  }

  async function editKnownIssues(release: Release) {
    const knownIssues = window.prompt(`编辑 ${release.version} 的已知问题：`, release.knownIssues ?? "");
    if (knownIssues === null) return;
    setBusy(true);
    try {
      const response = await authFetch(`/api/releases/${release.id}/known-issues`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ knownIssues }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "更新失败");
      await loadCatalog(); setToast(result.unchanged ? "已知问题未变更" : "已知问题已更新");
    } catch (error) { setToast(error instanceof Error ? error.message : "更新失败"); }
    finally { setBusy(false); }
  }

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedFile = form.get("file");
    if (selectedFile instanceof File && selectedFile.size > catalog.uploadMaxMb * 1024 * 1024) { setBusy(false); setToast(`文件过大，当前单文件上限为 ${catalog.uploadMaxMb} MB`); return; }
    if (modal === "upload" && selectedFile instanceof File) {
      const kind = String(form.get("kind") ?? "");
      const issue = firmwareFileIssue(kind, selectedFile.name);
      if (issue) { setBusy(false); setToast(issue); return; }
      const releaseId = String(form.get("releaseId") ?? "");
      const replaceArtifactId = String(form.get("replaceArtifactId") ?? "");
      const existing = catalog.artifacts.find((item) => item.releaseId === releaseId && item.kind === kind && !["已替换", "已替代", "已驳回", "候选"].includes(item.status));
      if (!replaceArtifactId && existing) { setBusy(false); setToast(`该栏已存在“${existing.name}”，请点击该文件的“替换”后再上传`); return; }
    }
    if (selectedFile instanceof File && selectedFile.size >= 50 * 1024 * 1024 && !window.confirm(`该文件约 ${(selectedFile.size / 1024 / 1024).toFixed(1)} MB，上传与校验可能需要较长时间。是否继续？`)) { setBusy(false); return; }
    try {
      let endpoint = "/api/artifacts"; let body: BodyInit = form; let headers: HeadersInit | undefined; let method = "POST";
      if (modal === "replace") endpoint = "/api/replacements";
      if (modal === "protocol") endpoint = "/api/protocols";
      if (modal === "protocolRecord" || modal === "editProtocol") { endpoint = modal === "editProtocol" && selectedProtocol ? `/api/protocols/${selectedProtocol.id}` : "/api/protocols"; method = modal === "editProtocol" ? "PATCH" : "POST"; body = JSON.stringify(Object.fromEntries(form)); headers = { "Content-Type": "application/json" }; }
      if (modal === "tool" || modal === "editTool") {
        endpoint = modal === "editTool" && selectedTool ? `/api/tools/${selectedTool.id}` : "/api/tools"; method = modal === "editTool" ? "PATCH" : "POST";
        body = JSON.stringify({ name: form.get("name"), version: form.get("version"), platform: form.get("platform"), status: form.get("status"), description: form.get("description"), productIds: form.getAll("productIds").map(String) });
        headers = { "Content-Type": "application/json" };
      }
      if (modal === "toolFile" && selectedTool) endpoint = `/api/tools/${selectedTool.id}/files`;
      if (modal === "productFile" && selectedProduct) endpoint = `/api/products/${selectedProduct.id}/files`;
      if (modal === "product" || modal === "editProduct") {
        const hardwareCodes = form.getAll("hwCode").map(String);
        endpoint = modal === "editProduct" && selectedProduct ? `/api/products/${selectedProduct.id}` : "/api/products";
        method = modal === "editProduct" ? "PATCH" : "POST";
        body = JSON.stringify({
          code: form.get("code"), name: form.get("name"), family: form.get("family"), ownerEmail: form.get("ownerEmail"), status: form.get("status"), description: form.get("description"),
          hardwareVariants: hardwareCodes.map((code, index) => ({ id: String(form.getAll("hwId")[index] ?? "") || undefined, code, mcu: String(form.getAll("mcu")[index] ?? ""), flashSize: String(form.getAll("flashSize")[index] ?? ""), ramSize: String(form.getAll("ramSize")[index] ?? ""), pcbVersion: String(form.getAll("pcbVersion")[index] ?? ""), minBootloader: String(form.getAll("minBootloader")[index] ?? ""), interfaces: String(form.getAll("interfaces")[index] ?? "") })),
          assetTypes: form.getAll("assetTypes").map(String), memberEmails: form.getAll("memberEmails").map(String),
        }); headers = { "Content-Type": "application/json" };
      }
      if (modal === "release") { endpoint = "/api/release-requests"; body = JSON.stringify(Object.fromEntries(form)); headers = { "Content-Type": "application/json" }; }
      if (modal === "version" || modal === "editVersion") {
        endpoint = modal === "editVersion" && selectedRelease ? `/api/releases/${selectedRelease.id}` : "/api/releases"; method = modal === "editVersion" ? "PATCH" : "POST";
        { const specifiedKinds = form.getAll("expectedKinds").map(String); const productId = String(form.get("productId") ?? ""); const fallbackKinds = catalog.assetTypes.filter((item) => item.productId === productId && ["OTA-APP", "OTA-Bootloader", "完整OTA包", "差分OTA包", "线刷包", "配置文件"].includes(item.assetType)).map((item) => item.assetType); body = JSON.stringify({ productId, version: form.get("version"), buildNumber: form.get("buildNumber"), channel: form.get("channel"), bootloaderVersion: form.get("bootloaderVersion"), appVersion: form.get("appVersion"), protocolSummary: form.get("protocolSummary"), minUpgradeVersion: form.get("minUpgradeVersion"), allowDowngrade: form.get("allowDowngrade") === "on", releaseNotes: form.get("releaseNotes"), knownIssues: form.get("knownIssues"), expectedKinds: specifiedKinds.length ? specifiedKinds : fallbackKinds, hardwareVariantIds: form.getAll("hardwareVariantIds").map(String), protocolIds: form.getAll("protocolIds").map(String) }); headers = { "Content-Type": "application/json" }; }
      }
      if (modal === "member") {
        endpoint = selectedMember ? `/api/users/${encodeURIComponent(selectedMember.email)}` : "/api/users"; method = selectedMember ? "PATCH" : "POST";
        body = JSON.stringify({ email: form.get("email"), displayName: form.get("displayName"), role: form.get("role"), status: form.get("status"), canCreateProducts: form.get("canCreateProducts") === "on", temporaryPassword: form.get("temporaryPassword"), productIds: form.getAll("productIds").map(String) }); headers = { "Content-Type": "application/json" };
      }
      const response = await authFetch(endpoint, { method, body, headers });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "操作失败");
      await loadCatalog();
      if (modal === "upload" && !selectedArtifact) {
        formElement.reset();
        setToast("文件已加入当前固件版本，可继续上传该版本的其他文件");
        return;
      }
      if (modal === "version") {
        setTargetReleaseId(String(result.id ?? "") || null);
        setSelectedRelease(null); setSelectedProtocol(null); setSelectedTool(null);
        setModal("upload");
        setToast("固件版本已创建，请继续上传该版本包含的文件");
        return;
      }
      setModal(null); setTargetReleaseId(null); setUploadKind(null); setSelectedMember(null); setSelectedRelease(null); setSelectedArtifact(null); setSelectedProtocol(null); setSelectedTool(null);
      setToast(modal === "replace" ? "替换申请已提交，等待管理员审批" : modal === "upload" ? "草稿版本文件已替换" : modal === "productFile" ? "产品资料已上传并完成校验" : modal === "protocol" ? "协议附件已上传并完成校验" : modal === "protocolRecord" ? "协议已经创建" : modal === "editProtocol" ? "协议信息已经更新" : modal === "tool" ? "工具已经创建" : modal === "editTool" ? "工具信息已经更新" : modal === "toolFile" ? "工具文件已上传并完成校验" : modal === "product" ? "产品已创建，可以开始建立首个固件版本" : modal === "editProduct" ? "产品信息已经更新" : modal === "release" ? "固件已进入测试任务池" : modal === "editVersion" ? "固件版本信息已经更新" : modal === "member" ? "成员信息与产品权限已保存" : "操作已经完成");
    } catch (error) { setToast(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function downloadArtifact(artifact: Artifact) {
    try { await startDownload(`/api/artifacts/${artifact.id}/download`, artifact.name); setToast(`已开始下载 ${artifact.name}`); }
    catch (error) { setToast(error instanceof Error ? error.message : "下载失败"); }
  }

  async function deleteArtifact(artifact: Artifact) {
    if (!window.confirm(`确认移除“${artifact.name}”吗？仅移除草稿版本中的文件。`)) return;
    setBusy(true);
    try {
      const response = await authFetch(`/api/artifacts/${artifact.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "移除失败");
      await loadCatalog(); setToast("草稿文件已移除");
    } catch (error) { setToast(error instanceof Error ? error.message : "移除失败"); }
    finally { setBusy(false); }
  }

  async function deleteMember(member: Member) {
    if (member.email.toLowerCase() === catalog.currentUser.email.toLowerCase()) return;
    if (!window.confirm(`删除成员“${member.displayName}”？该账号将无法再登录。`)) return;
    setBusy(true);
    try {
      const response = await authFetch(`/api/users/${encodeURIComponent(member.email)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "删除失败");
      await loadCatalog();
      setToast("成员已删除");
    } catch (error) { setToast(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  async function removeResource(kind: "product" | "release" | "protocol" | "tool", id: string) {
    const labels = { product: "产品", release: "固件版本", protocol: "协议", tool: "工具" };
    if (!window.confirm(kind === "product" ? "系统会先检查产品关联资料。空产品会直接删除；已有资料的产品会归档并可由管理员恢复，需输入产品型号二次确认。确定继续吗？" : `仅空白${labels[kind]}可以删除。确定继续吗？`)) return;
    setBusy(true);
    try {
      const base = kind === "product" ? "products" : kind === "release" ? "releases" : kind === "protocol" ? "protocols" : "tools";
      let response = await authFetch(`/api/${base}/${id}`, { method: "DELETE" }); let result = await response.json().catch(() => ({}));
      if (kind === "product" && response.status === 409 && result.canForceDelete) {
        const usage = result.usage ?? {};
        const confirmationCode = String(result.confirmationCode ?? "");
        const typed = window.prompt(`产品包含资料，系统将归档而不是永久删除，可由管理员恢复。\n\n固件版本：${usage.releases ?? 0}\n固件文件：${usage.artifacts ?? 0}\n产品资料：${usage.product_files ?? 0}\n通信协议：${usage.protocols ?? 0}\n工具：${usage.tools ?? 0}\n\n请输入完整产品型号 ${confirmationCode} 确认归档：`);
        if (typed === null) return;
        if (typed.trim() !== confirmationCode) { setToast("产品型号不匹配，已取消强制删除"); return; }
        response = await authFetch(`/api/${base}/${id}?force=true`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationCode: typed.trim() }) });
        result = await response.json().catch(() => ({}));
      }
      if (kind === "tool" && response.status === 409 && result.canForceDelete) {
        const count = Number(result.fileCount ?? 0);
        if (!window.confirm(`该工具包含 ${count} 个附件。删除会同时永久移除工具、附件和产品关联，确定继续吗？`)) return;
        response = await authFetch(`/api/${base}/${id}?force=true`, { method: "DELETE" });
        result = await response.json().catch(() => ({}));
      }
      if (!response.ok) throw new Error(result.error ?? "删除失败");
      await loadCatalog(); if (kind === "product") setSelectedProductId(null); setToast(result.archived ? "产品已归档，资料和流程记录已保留" : `${labels[kind]}已删除`);
    } catch (error) { setToast(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  async function downloadFile(url: string, fileName: string) {
    try { await startDownload(url, fileName); setToast(`已开始下载 ${fileName}`); }
    catch (error) { setToast(error instanceof Error ? error.message : "下载失败"); }
  }

  async function deleteProductFile(file: ProductFile) {
    if (!window.confirm(`确认删除“${file.fileName}”吗？删除当前版本时，系统会自动恢复上一版本。`)) return;
    setBusy(true);
    try {
      const response = await authFetch(`/api/products/files/${file.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "删除失败");
      await loadCatalog();
      setToast(result.restoredPrevious ? "文件已删除，已恢复上一版本" : "文件已删除");
    } catch (error) { setToast(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try {
      clearTabSession();
      const response = await authFetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("退出失败，请稍后重试");
      window.location.assign("/login");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "退出失败，请稍后重试");
      setBusy(false);
    }
  }

  async function updateUploadLimit(maxMb: number) {
    setBusy(true);
    try {
      const response = await authFetch("/api/settings/upload", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxMb }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "保存失败");
      await loadCatalog(); setSettingsOpen(false); setToast(`单文件上传上限已调整为 ${result.maxMb} MB`);
    } catch (error) { setToast(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function submitMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const isRequest = modal === "materialRequest";
      const isMaterialEdit = modal === "materialEdit";
      const response = await authFetch(isRequest ? "/api/material-requests" : isMaterialEdit ? `/api/materials/${selectedMaterial?.id}` : "/api/materials", {
        method: isMaterialEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRequest ? { materialId: selectedMaterial?.id, quantity: Number(form.get("quantity")), note: form.get("note") } : isMaterialEdit ? { availableQuantity: Number(form.get("quantity")), estimatedUnitPrice: Number(form.get("estimatedUnitPrice")) } : { name: form.get("name"), quantity: Number(form.get("quantity")), estimatedUnitPrice: Number(form.get("estimatedUnitPrice")), category: form.get("category"), note: form.get("note") }),
      });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "操作失败");
      await loadCatalog(); setModal(null); setSelectedMaterial(null);
      setToast(isRequest ? "领用申请已发送，请联系发布人确认" : isMaterialEdit ? "物料信息已更新" : "物料已发布，部门成员现在可以申请领用");
    } catch (error) { setToast(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function resolveMaterialRequest(id: string, action: "approve" | "reject") {
    setBusy(true);
    try {
      const response = await authFetch(`/api/material-requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "处理失败");
      await loadCatalog(); setToast(action === "approve" ? "已同意领用，物料数量已更新" : "已拒绝该领用申请");
    } catch (error) { setToast(error instanceof Error ? error.message : "处理失败"); }
    finally { setBusy(false); }
  }

  async function cancelMaterialRequest(id: string) {
    if (!window.confirm("撤销后会立即释放预留数量，确定撤销这项领用申请吗？")) return;
    setBusy(true);
    try {
      const response = await authFetch(`/api/material-requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "撤销失败");
      await loadCatalog(); setToast("领用申请已撤销，预留数量已释放");
    } catch (error) { setToast(error instanceof Error ? error.message : "撤销失败"); }
    finally { setBusy(false); }
  }

  async function updateMaterialStatus(material: Material, status: "已下架" | "可领用") {
    setBusy(true);
    try {
      const response = await authFetch(`/api/materials/${material.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? "更新失败");
      await loadCatalog(); setToast(status === "已下架" ? "物料已下架" : "物料已重新开放领用");
    } catch (error) { setToast(error instanceof Error ? error.message : "更新失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img className="brand-logo" src="/dnake-mark.png" alt="DNAKE" /></div><div><div className="brand-name">脑机交互研发平台</div><div className="brand-sub">厦门狄耐克智能科技股份有限公司</div></div></div>
        <nav className="nav" aria-label="主导航">
          {navItems.filter(([id]) => (id !== "members" || catalog.currentUser.isAdmin) && (id !== "testing" || catalog.currentUser.canTest)).map(([id, label, icon]) => {
            const unread = id === "approvals" || id === "testing" || id === "materials" ? unreadNotices[id] : 0;
            const pendingCount = id === "testing" ? pendingTests.length : id === "approvals" ? pending : 0;
            return <button key={id} className={`nav-button ${(view === id || (id === "testing" && view === "test-package")) ? "active" : ""}`} onClick={() => go(id)}><span className="nav-icon">{icon}</span>{label}{unread > 0 ? <span className="badge red nav-count">{unread} 新</span> : pendingCount > 0 ? <span className="badge amber nav-count">{pendingCount}</span> : null}</button>;
          })}
        </nav>
        <div className="sidebar-foot"><strong>脑机交互事业部</strong></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="search"><input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => { setView("products"); setSelectedProductId(null); setTestPackageId(null); }} placeholder="搜索产品、型号、版本或协议…" aria-label="全局搜索" /></div>
          <div className="user"><button className="settings-trigger" aria-label="打开设置" title="设置" onClick={() => setSettingsOpen(true)}>⚙</button><div className="avatar">{(catalog.currentUser.isSystemOwner ? "A" : catalog.currentUser.displayName || displayName).slice(0, 1)}</div><div className="user-copy"><strong>{catalog.currentUser.isSystemOwner ? "admin" : catalog.currentUser.displayName || displayName}</strong>{!catalog.currentUser.isSystemOwner && <small>{roleLabel(catalog.currentUser.role)}</small>}</div><button className="btn small ghost logout-button" disabled={busy} onClick={logout}>退出</button></div>
        </header>

        <div className="content">
          {syncError && <div className="form-note" role="status">暂时无法同步最新数据，当前内容已保留。{syncError} <button className="btn small" onClick={() => loadCatalog(true)}>重试同步</button></div>}
          {loading && <div className="loading">正在加载研发平台…</div>}
          {!loading && loadError && <div className="panel empty"><strong>数据暂时无法加载</strong><p>{loadError}</p><button className="btn" onClick={() => loadCatalog()}>重新加载</button></div>}
          {!loading && !loadError && view === "test-package" && !selectedProduct && <div className="panel empty">该任务对应的产品暂不可用。<button className="btn" onClick={() => go("testing")}>返回测试工作台</button></div>}
          {!loading && !loadError && view === "dashboard" && catalog.products.length === 0 && <EmptyOnboarding canCreateProduct={catalog.currentUser.canCreateProduct} isAdmin={catalog.currentUser.isAdmin} onCreate={() => setModal("product")} onMembers={() => go("members")} />}
          {!loading && !loadError && view === "dashboard" && catalog.products.length > 0 && <Dashboard catalog={catalog} openProduct={openProduct} />}
          {!loading && !loadError && view === "products" && !selectedProduct && <Products products={filteredProducts} releases={catalog.releases} canCreateProduct={catalog.currentUser.canCreateProduct} openProduct={openProduct} onCreate={() => setModal("product")} />}
          {!loading && !loadError && (view === "products" || view === "test-package") && selectedProduct && <ProductDetail key={`${selectedProduct.id}-${testPackageId ?? "product"}`} focusedReleaseId={view === "test-package" ? testPackageId : null} product={selectedProduct} releases={productReleases} releaseRequests={catalog.releaseRequests.filter((item) => item.productId === selectedProduct.id)} latest={latestRelease} artifacts={catalog.artifacts.filter((item) => item.productId === selectedProduct.id)} protocols={catalog.protocols.filter((item) => item.productId === selectedProduct.id)} protocolFiles={catalog.protocolFiles.filter((item) => item.productId === selectedProduct.id)} productFiles={catalog.productFiles.filter((item) => item.productId === selectedProduct.id)} tools={catalog.tools.filter((item) => (item.productIds ?? "").split(",").includes(selectedProduct.id))} toolFiles={catalog.toolFiles.filter((file) => catalog.tools.some((tool) => tool.id === file.toolId && (tool.productIds ?? "").split(",").includes(selectedProduct.id)))} users={catalog.users} auditLogs={catalog.auditLogs} hardwareVariants={catalog.hardwareVariants.filter((item) => item.productId === selectedProduct.id)} assetTypes={catalog.assetTypes.filter((item) => item.productId === selectedProduct.id)} canUpload={catalog.currentUser.canUpload || catalog.currentUser.ownedProductIds.includes(selectedProduct.id)} canDownloadPending={view === "test-package" || catalog.currentUser.isAdmin || catalog.currentUser.productIds.includes(selectedProduct.id) || catalog.currentUser.ownedProductIds.includes(selectedProduct.id)} canManageProduct={catalog.currentUser.isAdmin || catalog.currentUser.ownedProductIds.includes(selectedProduct.id)} isAdmin={catalog.currentUser.isAdmin} busy={busy} onBack={() => view === "test-package" ? go("testing") : setSelectedProductId(null)} onEdit={() => setModal("editProduct")} onDelete={() => removeResource("product", selectedProduct.id)} onReplace={(artifact) => { setSelectedArtifact(artifact); setModal("replace"); }} onPublish={(release) => { setSelectedRelease(release); setModal("release"); }} onNewVersion={() => { setTargetReleaseId(null); setModal("version"); }} onUploadFirmware={(release, kind, source) => { setTargetReleaseId(release?.id ?? null); setUploadKind(kind ?? null); setSelectedArtifact(source ?? null); setModal("upload"); }} onUploadProductFile={(category) => { setProductFileCategory(category); setModal("productFile"); }} onDeleteProductFile={deleteProductFile} onDeleteArtifact={deleteArtifact} onEditKnownIssues={editKnownIssues} onEditVersion={(release) => { setSelectedRelease(release); setModal("editVersion"); }} onCreateProtocol={() => { setSelectedProtocol(null); setModal("protocolRecord"); }} onUploadProtocol={(protocol) => { setSelectedProtocol(protocol); setModal("protocol"); }} onEditProtocol={(protocol) => { setSelectedProtocol(protocol); setModal("editProtocol"); }} onDeleteProtocol={(protocol) => removeResource("protocol", protocol.id)} onStatus={updateReleaseStatus} onPromoteTrial={promoteTrialRelease} onDownload={downloadArtifact} onDownloadFile={downloadFile} />}
          {!loading && !loadError && view === "firmware" && <FirmwareManagement products={catalog.products} releases={catalog.releases} artifacts={catalog.artifacts} canUpload={catalog.currentUser.canUpload} busy={busy} onCreate={() => { setSelectedRelease(null); setTargetReleaseId(null); setModal("version"); }} onUpload={(release) => { setTargetReleaseId(release?.id ?? null); setModal("upload"); }} onOpenProduct={openProduct} onEdit={(release) => { setSelectedRelease(release); setSelectedProductId(release.productId); setModal("editVersion"); }} onDelete={(release) => removeResource("release", release.id)} />}
          {!loading && !loadError && view === "protocols" && <Protocols protocols={catalog.protocols} products={catalog.products} files={catalog.protocolFiles} canUpload={catalog.currentUser.canUpload} busy={busy} onCreate={() => { setSelectedProtocol(null); setModal("protocolRecord"); }} onUpload={(protocol) => { setSelectedProtocol(protocol); setSelectedProductId(protocol.productId); setModal("protocol"); }} onEdit={(protocol) => { setSelectedProtocol(protocol); setModal("editProtocol"); }} onDelete={(protocol) => removeResource("protocol", protocol.id)} onDownload={(file) => downloadFile(`/api/protocols/files/${file.id}/download`, file.fileName)} />}
          {!loading && !loadError && view === "tools" && <Tools tools={catalog.tools} files={catalog.toolFiles} canUpload={catalog.currentUser.canUpload} busy={busy} onCreate={() => { setSelectedTool(null); setModal("tool"); }} onUpload={(tool) => { setSelectedTool(tool); setModal("toolFile"); }} onEdit={(tool) => { setSelectedTool(tool); setModal("editTool"); }} onDelete={(tool) => removeResource("tool", tool.id)} onDownload={(file) => downloadFile(`/api/tools/files/${file.id}/download`, file.fileName)} />}
          {!loading && !loadError && view === "lcsc-3d" && <Lcsc3DDownloader />}
          {!loading && !loadError && view === "materials" && <Materials materials={catalog.materials} requests={catalog.materialRequests} stats={catalog.materialStats} currentUser={catalog.currentUser} busy={busy} onPublish={() => { setSelectedMaterial(null); setModal("material"); }} onRequest={(material) => { setSelectedMaterial(material); setModal("materialRequest"); }} onEdit={(material) => { setSelectedMaterial(material); setModal("materialEdit"); }} onResolve={resolveMaterialRequest} onCancel={cancelMaterialRequest} onStatus={updateMaterialStatus} />}
          {!loading && !loadError && view === "testing" && catalog.currentUser.canTest && <TestingWorkbench releases={catalog.releaseRequests} artifacts={catalog.artifacts} currentUser={catalog.currentUser} busy={busy} onOpenPackage={openTestPackage} onAction={(id, action) => action === "claim" || action === "unclaim" ? review(id, action, "release") : setWorkflowDecision({ id, action, kind: "release" })} />}
          {!loading && !loadError && view === "approvals" && <Approvals replacements={catalog.replacements} releases={catalog.releaseRequests} artifacts={catalog.artifacts} currentUser={catalog.currentUser} canApprove={catalog.currentUser.canApprove} busy={busy} onDecision={(id, action, kind) => setWorkflowDecision({ id, action, kind })} />}
          {!loading && !loadError && view === "members" && catalog.currentUser.isAdmin && <Members users={catalog.users} products={catalog.products} currentEmail={catalog.currentUser.email} busy={busy} onAdd={() => { setSelectedMember(null); setModal("member"); }} onEdit={(member) => { setSelectedMember(member); setModal("member"); }} onDelete={(member) => void deleteMember(member)} />}
        </div>
      </main>

      {modal && modal !== "material" && modal !== "materialRequest" && modal !== "materialEdit" && (modal !== "member" || catalog.currentUser.isAdmin) && <ActionModal key={`${modal}-${targetReleaseId ?? ""}-${uploadKind ?? ""}-${selectedArtifact?.id ?? ""}-${productFileCategory}`} mode={modal} products={catalog.products} productFiles={catalog.productFiles} releases={selectedProductId ? productReleases : catalog.releases} protocols={catalog.protocols} users={catalog.users} ownerCandidates={catalog.ownerCandidates} currentUser={catalog.currentUser} selectedMember={selectedMember} selectedRelease={selectedRelease} targetReleaseId={targetReleaseId} selectedProtocol={selectedProtocol} selectedTool={selectedTool} selectedProduct={selectedProduct} selectedProductId={selectedProductId} allHardwareVariants={catalog.hardwareVariants} allAssetTypes={catalog.assetTypes} selectedHardwareVariants={catalog.hardwareVariants.filter((item) => item.productId === selectedProductId)} selectedAssetTypes={catalog.assetTypes.filter((item) => item.productId === selectedProductId)} sourceArtifact={selectedArtifact ?? undefined} uploadKind={uploadKind ?? undefined} productFileCategory={productFileCategory} uploadMaxMb={catalog.uploadMaxMb} busy={busy} onCreateVersion={() => { setTargetReleaseId(null); setModal("version"); }} onClose={() => { setModal(null); setTargetReleaseId(null); setUploadKind(null); setSelectedMember(null); setSelectedRelease(null); setSelectedArtifact(null); setSelectedProtocol(null); setSelectedTool(null); }} onSubmit={submitModal} />}
      {(modal === "material" || modal === "materialRequest" || modal === "materialEdit") && <MaterialModal mode={modal} material={selectedMaterial} busy={busy} onClose={() => { setModal(null); setSelectedMaterial(null); }} onSubmit={submitMaterial} />}
      {settingsOpen && <SettingsPanel currentUser={catalog.currentUser} uploadMaxMb={catalog.uploadMaxMb} busy={busy} onClose={() => setSettingsOpen(false)} onSaveUploadLimit={updateUploadLimit} />}
      {workflowDecision && <DecisionModal decision={workflowDecision} busy={busy} users={catalog.users} onClose={() => setWorkflowDecision(null)} onSubmit={(note, report, scope, members) => review(workflowDecision.id, workflowDecision.action, workflowDecision.kind, note, report, scope, members)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {realtimeNotice && <div className="realtime-toast" role="alert" aria-live="assertive"><button className="realtime-toast-open" type="button" onClick={() => go(realtimeNotice.view)}><span>重要提醒</span><strong>{realtimeNotice.message}</strong><small>点击立即查看 · 未处理前会持续提示</small></button><button className="realtime-toast-close" type="button" aria-label="关闭提醒" onClick={() => setRealtimeNotices((current) => current.slice(1))}>×</button></div>}
    </div>
  );
}

function EmptyOnboarding({ canCreateProduct, isAdmin, onCreate, onMembers }: { canCreateProduct: boolean; isAdmin: boolean; onCreate: () => void; onMembers: () => void }) {
  return <div className="onboarding"><div className="onboarding-mark"><img className="brand-logo" src="/dnake-mark.png" alt="DNAKE" /></div><div className="eyebrow">DNAKE · BCI R&amp;D</div><h1>创建第一个真实产品</h1><p>从产品与硬件版本开始，逐步建立固件、通信协议、研发工具和成员协作资料。</p><div className="onboarding-steps"><div><span>1</span><strong>产品与硬件</strong><small>型号、MCU、Flash、接口</small></div><div><span>2</span><strong>协作分工</strong><small>开发、测试、审核、只读</small></div><div><span>3</span><strong>研发资产</strong><small>固件、OTA、协议和工具</small></div></div><div className="actions">{canCreateProduct && <button className="btn primary" onClick={onCreate}>创建第一个产品</button>}{isAdmin && <button className="btn" onClick={onMembers}>管理事业部成员</button>}</div></div>;
}

function Dashboard({ catalog, openProduct }: { catalog: Catalog; openProduct: (id: string) => void }) {
  const [activityFilter, setActivityFilter] = useState("全部");
  const activityCategory = (item: AuditLog) => {
    const action = item.action.toLowerCase();
    if (item.resourceType === "user" || action.startsWith("user.")) return "成员权限";
    if (item.resourceType === "material" || action.startsWith("material.")) return "研发物料";
    if (action.includes("approve") || action.includes("reject") || action.includes("test_") || action.includes("submit_test") || item.resourceType === "replacement") return "审批测试";
    if (item.resourceType === "release" || item.resourceType === "artifact" || action.startsWith("release.") || action.startsWith("artifact.")) return "固件版本";
    if (action.startsWith("prototype.")) return "软件原型";
    if (["product", "protocol", "tool"].includes(item.resourceType)) return "产品资料";
    return "其他";
  };
  const activityFilters = ["全部", "固件版本", "审批测试", "成员权限", "产品资料", "研发物料", "软件原型", "其他"];
  const filteredActivities = activityFilter === "全部" ? catalog.auditLogs : catalog.auditLogs.filter((item) => activityCategory(item) === activityFilter);
  const activityCounts = new Map(activityFilters.map((filter) => [filter, filter === "全部" ? catalog.auditLogs.length : catalog.auditLogs.filter((item) => activityCategory(item) === filter).length]));
  const actorName = (email: string) => catalog.users.find((user) => user.email.toLowerCase() === email.toLowerCase())?.displayName ?? (email === "系统所有者" ? "admin" : email);
  const publishedReleases = catalog.releases.filter((release) => release.status === "已发布" && release.channel === "正式发布");
  const currentEmail = catalog.currentUser.email.toLowerCase();
  const testingTodos = catalog.currentUser.canTest
    ? catalog.releaseRequests.filter((item) => ["待领取", "测试中"].includes(item.status)
      && (!item.assignedTesterEmail || item.assignedTesterEmail.toLowerCase() === currentEmail)).length
    : 0;
  const approvalTodos = catalog.currentUser.canApprove
    ? catalog.replacements.filter((item) => item.status === "待审批").length + catalog.releaseRequests.filter((item) => ["待审核", "待终审"].includes(item.status)).length
    : 0;
  const todoCount = testingTodos + approvalTodos;
  const materialValue = catalog.materials
    .filter((item) => item.status === "可领用")
    .reduce((total, item) => total + Number(item.availableQuantity || 0) * Number(item.estimatedUnitPrice || 0), 0);
  const todoNote = todoCount ? `测试 ${testingTodos} 项 · 审批 ${approvalTodos} 项` : "暂无需要处理的测试或审批";
  return <>
    <div className="page-head"><div><div className="eyebrow">DNAKE · BCI R&amp;D OPERATIONS</div><h1>研发资产总览</h1><p>集中管理脑机交互产品、固件、OTA、通信协议、生产工具和发布流程。</p></div></div>
    <div className="metric-grid">
      <Metric label="产品型号" value={catalog.products.length} note={`${new Set(catalog.products.map((item) => item.family)).size} 个产品系列`} />
      <Metric label="我的待办" value={todoCount} note={todoNote} warn={todoCount > 0} />
      <Metric label="可复用物料价值" value={formatCurrency(materialValue)} note={`${catalog.materials.filter((item) => item.status === "可领用").length} 条可领用物料`} good />
      <Metric label="累计节约成本" value={formatCurrency(catalog.materialStats.savedCost)} note={`已复用 ${catalog.materialStats.sharedQuantity.toLocaleString("zh-CN")} 个物料`} good />
    </div>
    <div className="grid-2">
      <section className="panel"><div className="panel-head"><div><div className="panel-title">最近已发布固件</div><div className="panel-sub">仅展示已通过测试和审批的版本</div></div></div><div className="table-wrap"><table><thead><tr><th>产品</th><th>版本</th><th>通道</th><th>协议</th><th>更新时间</th><th></th></tr></thead><tbody>{publishedReleases.slice(0, 6).map((release) => { const p = catalog.products.find((x) => x.id === release.productId); return <tr key={release.id}><td><div className="cell-main">{p?.name}</div><div className="cell-sub code">{p?.code}</div></td><td><div className="cell-main">{release.version}</div><div className="cell-sub">Build {release.buildNumber}</div></td><td><span className="badge green"><span className="dot" />{release.channel}</span></td><td>{release.protocolSummary || "—"}</td><td>{formatUpdateTime(release.updatedAt || release.releaseDate)}</td><td><button className="btn small ghost" onClick={() => openProduct(release.productId)}>查看</button></td></tr>; })}{publishedReleases.length === 0 && <tr><td colSpan={6}><div className="empty compact">尚无已发布固件版本</div></td></tr>}</tbody></table></div></section>
      <section className="panel"><div className="panel-head"><div><div className="panel-title">近期动态</div><div className="panel-sub">按操作类型筛选，快速查看对应动态</div></div></div><div className="panel-body"><div className="activity-filters" role="group" aria-label="按操作类型筛选动态">{activityFilters.filter((filter) => filter === "全部" || (activityCounts.get(filter) ?? 0) > 0).map((filter) => <button key={filter} type="button" className={`activity-filter${activityFilter === filter ? " active" : ""}`} aria-pressed={activityFilter === filter} onClick={() => setActivityFilter(filter)}>{filter}<span>{activityCounts.get(filter) ?? 0}</span></button>)}</div><div className="activity-list">{filteredActivities.slice(0, 5).map((item) => { const category = activityCategory(item); const mark = category === "成员权限" ? "权" : category === "固件版本" ? "固" : category === "审批测试" ? "审" : category === "研发物料" ? "料" : category === "软件原型" ? "原" : category === "产品资料" ? "产" : "记"; return <Activity key={item.id} mark={mark} text={formatAuditDetail(item.detail)} actor={actorName(item.actorEmail)} time={new Date(item.createdAt).toLocaleString("zh-CN")} />; })}{filteredActivities.length === 0 && <div className="empty compact">{catalog.auditLogs.length === 0 ? "暂无操作记录" : `暂无“${activityFilter}”动态`}</div>}</div>{filteredActivities.length > 5 && <div className="activity-more">当前显示最新 5 条，共 {filteredActivities.length} 条{activityFilter === "全部" ? "" : ` · ${activityFilter}`}</div>}</div></section>
    </div>
  </>;
}

function Metric({ label, value, note, good, warn }: { label: string; value: number | string; note: string; good?: boolean; warn?: boolean }) { const displayValue = typeof value === "number" ? String(value).padStart(2, "0") : value; return <div className="metric"><div className="metric-label">{label}</div><div className={`metric-value ${typeof value === "string" ? "currency" : ""}`}>{displayValue}</div><div className={`metric-note ${good ? "good" : warn ? "warn" : ""}`}>{note}</div></div>; }
function Activity({ mark, text, actor, time }: { mark: string; text: string; actor?: string; time: string }) { return <div className="activity"><div className="activity-mark">{mark}</div><div><p>{text}</p><time>{actor ? `${actor} · ${time}` : time}</time></div></div>; }

function Products({ products, releases, canCreateProduct, openProduct, onCreate }: { products: Product[]; releases: Release[]; canCreateProduct: boolean; openProduct: (id: string) => void; onCreate: () => void }) {
  return <><div className="page-head"><div><div className="eyebrow">Product Catalog</div><h1>产品管理</h1><p>维护产品型号、硬件配置、负责人和资料范围。</p></div><div className="actions">{canCreateProduct && <button className="btn primary" onClick={onCreate}>＋ 新建产品</button>}</div></div><div className="product-grid">{products.map((product) => { const latest = releases.find((item) => item.productId === product.id); return <button className="product-card" key={product.id} onClick={() => openProduct(product.id)}><div className="product-top"><div className="product-symbol">{product.code.split("-")[1] || product.code.slice(0, 3)}</div><span className={`badge ${product.status === "量产" ? "green" : product.status === "试产" ? "amber" : ""}`}>{product.status}</span></div><h3>{product.name}</h3><p>{product.description || "暂无产品说明"}</p><div className="product-meta"><div><span>产品型号</span><strong className="code">{product.code}</strong></div><div><span>最新固件</span><strong>{latest?.version ?? "尚未发布"}</strong></div><div><span>硬件版本</span><strong>{product.hwVersions}</strong></div><div><span>负责人</span><strong>{product.owner}</strong></div></div></button>; })}</div>{products.length === 0 && <div className="empty">没有找到匹配的产品</div>}</>;
}

function FirmwareManagement({ products, releases, artifacts, canUpload, busy, onCreate, onUpload, onOpenProduct, onEdit, onDelete }: { products: Product[]; releases: Release[]; artifacts: Artifact[]; canUpload: boolean; busy: boolean; onCreate: () => void; onUpload: (release?: Release) => void; onOpenProduct: (id: string) => void; onEdit: (release: Release) => void; onDelete: (release: Release) => void }) {
  return <><div className="page-head"><div><div className="eyebrow">Firmware Library</div><h1>固件版本</h1><p>从产品内的 APP、Bootloader、OTA 或线刷包栏位上传对应文件。</p></div>{canUpload && <div className="actions"><button className="btn" onClick={onCreate}>＋ 新建固件版本</button></div>}</div>
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>产品</th><th>固件版本</th><th>构建号</th><th>通道 / 状态</th><th>Bootloader / APP</th><th>版本包含</th><th>协议</th><th></th></tr></thead><tbody>{releases.map((release) => { const product = products.find((item) => item.id === release.productId); const files = artifacts.filter((item) => item.releaseId === release.id && item.kind !== "测试报告"); const fileKinds = [...new Set(files.map((item) => artifactGroupLabel(item.kind)))]; const writable = ["草稿", "测试中"].includes(release.status); return <tr key={release.id}><td><div className="cell-main">{product?.name}</div><div className="cell-sub code">{product?.code}</div></td><td className="cell-main">{release.version}</td><td className="code">{release.buildNumber}</td><td><span className={`badge ${release.status === "已发布" ? "green" : "amber"}`}>{release.channel} · {release.status}</span></td><td><div>{release.bootloaderVersion}</div><div className="cell-sub">APP {release.appVersion}</div></td><td><div className="bundle-kind-list">{fileKinds.map((kind) => <span className="badge" key={kind}>{kind}</span>)}{files.length === 0 && <span className="text-muted">暂无文件</span>}</div></td><td>{release.protocolSummary || "未绑定"}</td><td><div className="row-actions">{canUpload && writable && <button className="btn small primary" onClick={() => onUpload(release)}>上传文件</button>}<button className="btn small" onClick={() => onOpenProduct(release.productId)}>查看版本包</button>{canUpload && <><button className="btn small ghost" onClick={() => onEdit(release)}>编辑</button><button className="btn small danger" disabled={busy || files.length > 0} title={files.length ? "已有文件，不能删除" : "删除空版本"} onClick={() => onDelete(release)}>删除</button></>}</div></td></tr>; })}{releases.length === 0 && <tr><td colSpan={8}><div className="empty compact"><strong>还没有固件版本</strong><p>先创建固件版本，再上传 APP、Bootloader、OTA 或线刷包。</p>{canUpload && <button className="btn primary" onClick={onCreate}>创建第一个固件版本</button>}</div></td></tr>}</tbody></table></div></section>
  </>;
}

const firmwarePackageGroups = [
  { id: "app", label: "APP OTA 包", assetTypes: ["OTA-APP"], kinds: ["APP固件", "OTA-APP"] },
  { id: "bootloader", label: "Bootloader OTA 包", assetTypes: ["OTA-Bootloader"], kinds: ["Bootloader固件", "OTA-Bootloader"] },
  { id: "full-ota", label: "整包 OTA", assetTypes: ["完整OTA包"], kinds: ["完整OTA包"] },
  { id: "delta-ota", label: "差分 OTA", assetTypes: ["差分OTA包"], kinds: ["差分OTA包"] },
  { id: "flash", label: "线刷包", assetTypes: ["线刷包"], kinds: ["线刷包"] },
  { id: "config", label: "配置文件", assetTypes: ["配置文件"], kinds: ["配置文件"] },
];

function artifactGroupLabel(kind: string) {
  return firmwarePackageGroups.find((group) => group.kinds.includes(kind))?.label ?? "未分类文件";
}

function FirmwareBundleFiles({ files, release, assetTypes, canDownload, canUpload, canDirectEdit, onDownload, onRemove, onReplace, onUpload }: { files: Artifact[]; release: Release; assetTypes: Set<string>; canDownload: boolean; canUpload: boolean; canDirectEdit: boolean; onDownload: (artifact: Artifact) => void; onRemove: (artifact: Artifact) => void; onReplace: (artifact: Artifact) => void; onUpload: (release: Release, kind: string, source?: Artifact) => void }) {
  const visibleGroups = firmwarePackageGroups.filter((group) => group.assetTypes.some((type) => assetTypes.has(type)));
  return <div className="firmware-package-grid">{visibleGroups.map((group) => {
    const groupFiles = files.filter((item) => group.kinds.includes(item.kind) && !["已替换", "已替代", "已驳回", "候选"].includes(item.status));
    return <section className={`firmware-package ${groupFiles.length ? "has-files" : ""}`} key={group.id}><div className="firmware-package-head"><strong>{group.label}</strong><span>{groupFiles.length}</span></div>{groupFiles.length ? <div className="firmware-package-files">{groupFiles.map((item) => <div className="firmware-package-file" key={item.id}><div><strong title={item.name}>{item.name}</strong><small>{item.kind} · {item.revision} · {formatSize(item.size)}</small><code title={item.sha256}>SHA-256 {item.sha256.slice(0, 12)}…</code></div><div className="row-actions">{canDownload && <button className="btn small" onClick={() => onDownload(item)}>下载</button>}{!canDownload && <span className="text-muted">仅协作成员可下载</span>}{canDirectEdit ? <><button className="btn small ghost" onClick={() => onUpload(release, item.kind, item)}>替换</button><button className="btn small danger" onClick={() => onRemove(item)}>移除</button></> : canUpload && item.active === 1 && <button className="btn small ghost" onClick={() => onReplace(item)}>申请替换</button>}</div></div>)}</div> : <div className="firmware-package-empty"><span>未上传</span>{canUpload && <button className="btn small primary" onClick={() => onUpload(release, group.kinds[0])}>上传{group.label}</button>}</div>}</section>;
  })}</div>;
}

function ReleaseWorkflow({ release, request }: { release: Release; request?: ReleaseRequest }) {
  const requestStatus = request?.status;
  const active = release.status === "已发布" || requestStatus === "已批准" ? 4 : ["待审核", "待终审"].includes(requestStatus ?? "") ? 3 : release.status === "测试中" || ["待领取", "测试中"].includes(requestStatus ?? "") ? 2 : release.status === "开发自测" ? 1 : 0;
  const steps = ["草稿", "开发自测", "测试", "审批", "发布"];
  return <div className="workflow-rail" aria-label="版本发布流程">{steps.map((step, index) => <div className={`workflow-step ${index < active ? "done" : ""} ${index === active ? "current" : ""}`} key={step}><span>{index < active ? "✓" : index + 1}</span><small>{step}</small></div>)}</div>;
}

function ProductDetail({ focusedReleaseId, product, releases, releaseRequests, latest, artifacts, protocols, protocolFiles, productFiles, tools, toolFiles, users, auditLogs, hardwareVariants, assetTypes, canUpload, canDownloadPending, canManageProduct, isAdmin, busy, onBack, onEdit, onDelete, onReplace, onPublish, onNewVersion, onUploadFirmware, onUploadProductFile, onDeleteProductFile, onDeleteArtifact, onEditKnownIssues, onEditVersion, onCreateProtocol, onUploadProtocol, onEditProtocol, onDeleteProtocol, onStatus, onPromoteTrial, onDownload, onDownloadFile }: { focusedReleaseId?: string | null; product: Product; releases: Release[]; releaseRequests: ReleaseRequest[]; latest?: Release; artifacts: Artifact[]; protocols: Protocol[]; protocolFiles: ProtocolFile[]; productFiles: ProductFile[]; tools: Tool[]; toolFiles: ToolFile[]; users: Member[]; auditLogs: AuditLog[]; hardwareVariants: HardwareVariant[]; assetTypes: AssetType[]; canUpload: boolean; canDownloadPending: boolean; canManageProduct: boolean; isAdmin: boolean; busy: boolean; onBack: () => void; onEdit: () => void; onDelete: () => void; onReplace: (artifact: Artifact) => void; onPublish: (release: Release) => void; onNewVersion: () => void; onUploadFirmware: (release?: Release, kind?: string, source?: Artifact) => void; onUploadProductFile: (category: ProductFile["category"]) => void; onDeleteProductFile: (file: ProductFile) => void; onDeleteArtifact: (artifact: Artifact) => void; onEditKnownIssues: (release: Release) => void; onEditVersion: (release: Release) => void; onCreateProtocol: () => void; onUploadProtocol: (protocol: Protocol) => void; onEditProtocol: (protocol: Protocol) => void; onDeleteProtocol: (protocol: Protocol) => void; onStatus: (release: Release, status: "草稿" | "开发自测" | "测试中") => void; onPromoteTrial: (release: Release) => void; onDownload: (artifact: Artifact) => void; onDownloadFile: (url: string, fileName: string) => void }) {
  const [tab, setTab] = useState<"overview" | "hardware" | "firmware" | "protocols" | "tools" | "settings" | "prototypes">(focusedReleaseId ? "firmware" : "overview");
  const [expandedDocumentHistory, setExpandedDocumentHistory] = useState<Set<ProductFile["category"]>>(new Set());
  const releaseIds = new Set(releases.map((item) => item.id));
  const memberRows = users.filter((user) => user.role === "admin" || (user.productIds ?? "").split(",").includes(product.id));
  const productAudits = auditLogs.filter((item) => item.resourceId === product.id || releaseIds.has(item.resourceId));
  const selectedAssets = new Set(focusedReleaseId ? [...(releases.find((item) => item.id === focusedReleaseId)?.expectedKinds ?? "").split(","), ...artifacts.filter((item) => item.releaseId === focusedReleaseId).map((item) => item.kind)] : assetTypes.map((item) => item.assetType));
  const hasFirmwareAssets = ["OTA-APP", "OTA-Bootloader", "完整OTA包", "差分OTA包", "线刷包", "配置文件"].some((item) => selectedAssets.has(item));
  const hasProtocolAssets = selectedAssets.has("通信协议");
  const hasToolAssets = selectedAssets.has("烧录工具") || selectedAssets.has("调试工具");
  const inWorkflow = releaseRequests.filter((item) => ["待领取", "测试中", "待审核", "待终审"].includes(item.status));
  const documentTypes: Array<{ assetType: string; category: ProductFile["category"]; label: string }> = [
    { assetType: "产品立项书", category: "project_charter", label: "产品立项书" },
    { assetType: "产品需求文档", category: "requirements", label: "产品需求文档" },
  ];
  const enabledDocumentTypes = documentTypes.filter((item) => selectedAssets.has(item.assetType));
  const tabs: Array<{ id: "overview" | "hardware" | "firmware" | "protocols" | "tools" | "settings" | "prototypes"; label: string }> = [
    { id: "overview", label: "概览" },
    { id: "hardware", label: `硬件 ${hardwareVariants.length}` },
    { id: "firmware", label: `固件 ${releases.length}` },
    { id: "protocols", label: `协议 ${protocols.length}` },
    { id: "tools", label: `工具 ${tools.length}` },
    { id: "prototypes", label: "软件原型" },
    ...(canManageProduct ? [{ id: "settings" as const, label: "产品设置" }] : []),
  ];
  return <><button className="back" onClick={onBack}>{focusedReleaseId ? "← 返回测试工作台" : "← 返回产品列表"}</button>{focusedReleaseId ? <div className="page-head"><div><div className="eyebrow">测试版本包</div><h1>{product.name}</h1><p>当前只显示这条测试任务对应的固件版本。</p></div></div> : <div className="detail-banner"><div><div className="eyebrow" style={{ color: "#7fe0cc" }}>{product.code} · {product.family}</div><h2>{product.name}</h2><p>{product.description || "暂无产品说明"}</p></div><div className="detail-stats"><div><span>当前稳定版</span><strong>{releases.find((item) => item.status === "已发布")?.version ?? "—"}</strong></div><div><span>硬件版本</span><strong>{hardwareVariants.length}</strong></div><div><span>流程中版本</span><strong>{inWorkflow.length}</strong></div></div></div>}
    {!focusedReleaseId && <div className="workspace-head"><div className="workspace-tabs">{tabs.map(({ id, label }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div></div>}
    {tab === "overview" && <div className="workspace-grid"><section className="panel"><div className="panel-head"><div className="panel-title">产品资料概况</div></div><div className="panel-body"><div className="overview-cards"><div><span>硬件版本</span><strong>{hardwareVariants.length}</strong><small>{product.hwVersions}</small></div>{hasFirmwareAssets && <div><span>固件版本</span><strong>{releases.length}</strong><small>{latest?.status ?? "尚未创建"}</small></div>}{hasProtocolAssets && <div><span>通信协议</span><strong>{protocols.length}</strong><small>{protocolFiles.length} 个附件</small></div>}{hasToolAssets && <div><span>烧录工具</span><strong>{tools.length}</strong><small>{toolFiles.length} 个文件</small></div>}</div></div></section>{enabledDocumentTypes.length > 0 && <section className="panel"><div className="panel-head"><div className="panel-title">产品文档</div></div><div className="panel-body"><div className="document-upload-grid">{enabledDocumentTypes.map((item) => { const files = productFiles.filter((candidate) => candidate.category === item.category).sort((a, b) => Number(b.active) - Number(a.active) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); const current = files.find((file) => Number(file.active) === 1) ?? files[0]; const history = files.filter((file) => file.id !== current?.id); const historyOpen = expandedDocumentHistory.has(item.category); return <div className="document-upload-card" key={item.category}><div><strong>{item.label}</strong>{current && <span className="document-version">{current.version || "V1.0"}</span>}</div>{current ? <div className="document-current"><button className="attachment-line file-button" onClick={() => onDownloadFile(`/api/products/files/${current.id}/download`, current.fileName)}>{current.fileName} · {formatSize(current.size)}</button><small>{current.uploadedBy} · {formatDateTime(current.createdAt)}{current.changeNote ? ` · ${current.changeNote}` : ""}</small>{history.length > 0 && <button className="text-button" onClick={() => setExpandedDocumentHistory((value) => { const next = new Set(value); if (next.has(item.category)) next.delete(item.category); else next.add(item.category); return next; })}>{historyOpen ? "收起历史版本" : `历史版本（${history.length}）`}</button>}{historyOpen && <div className="document-history">{history.map((file) => <div key={file.id}><span>{file.version || "V1.0"}</span><button className="attachment-line file-button" onClick={() => onDownloadFile(`/api/products/files/${file.id}/download`, file.fileName)}>{file.fileName}</button>{isAdmin && <button className="text-button danger-text" disabled={busy} onClick={() => onDeleteProductFile(file)}>删除</button>}<small>{file.uploadedBy} · {formatDateTime(file.createdAt)}{file.changeNote ? ` · ${file.changeNote}` : ""}</small></div>)}</div>}</div> : <span className="text-muted">尚未上传</span>}<div className="document-actions">{canUpload && <button className="btn small" onClick={() => onUploadProductFile(item.category)}>{current ? "上传新版本" : "上传文件"}</button>}{isAdmin && current && <button className="btn small danger" disabled={busy} onClick={() => onDeleteProductFile(current)}>删除</button>}</div></div>; })}</div></div></section>}</div>}
    {tab === "hardware" && <><section className="panel"><div className="panel-head"><div><div className="panel-title">硬件版本</div><div className="panel-sub">固件兼容范围以这里的硬件配置为准</div></div></div><div className="table-wrap"><table><thead><tr><th>硬件版本</th><th>MCU / SoC</th><th>Flash / RAM</th><th>PCB</th><th>最低 Bootloader</th><th>通信接口</th></tr></thead><tbody>{hardwareVariants.map((item) => <tr key={item.id}><td className="cell-main code">{item.code}</td><td>{item.mcu}</td><td>{item.flashSize} / {item.ramSize}</td><td>{item.pcbVersion}</td><td>{item.minBootloader}</td><td>{item.interfaces}</td></tr>)}</tbody></table></div></section>{selectedAssets.has("电路文件") && <section className="panel" style={{ marginTop: 18 }}><div className="panel-head"><div><div className="panel-title">电路文件</div><div className="panel-sub">原理图、PCB、BOM、结构件等硬件资料</div></div>{canUpload && <button className="btn small" onClick={() => onUploadProductFile("hardware_package")}>上传电路文件</button>}</div><div className="panel-body"><div className="file-list">{productFiles.filter((file) => file.category === "hardware_package").map((file) => <button className="attachment-line file-button" key={file.id} onClick={() => onDownloadFile(`/api/products/files/${file.id}/download`, file.fileName)}>{file.fileName} · {formatSize(file.size)}</button>)}{productFiles.filter((file) => file.category === "hardware_package").length === 0 && <span className="text-muted">尚未上传电路文件</span>}</div></div></section>}</>}
    {tab === "prototypes" && <PrototypeWorkspace key={product.id} productId={product.id} />}
    {tab === "firmware" && <>
      <div className="page-head workspace-actions"><div><h1 style={{ fontSize: 19 }}>固件版本包</h1><p>一个版本包对应一次可追溯的测试与发布流程。</p></div>{canUpload && !focusedReleaseId && <div className="actions"><button className="btn primary" onClick={onNewVersion}>＋ 新建固件版本</button></div>}</div>
      {releases.filter((release) => !focusedReleaseId || release.id === focusedReleaseId).map((release) => {
        const files = artifacts.filter((item) => item.releaseId === release.id && item.kind !== "测试报告" && !["已替换", "已替代", "已驳回", "候选"].includes(item.status));
        const testReports = artifacts.filter((item) => item.releaseId === release.id && item.kind === "测试报告");
        const canEditRelease = release.status === "草稿" || release.status === "开发自测";
        const request = releaseRequests.find((item) => item.releaseId === release.id && !["已批准", "已驳回", "测试未通过"].includes(item.status));
        return <section className="panel release-workspace" key={release.id}>
          <div className="panel-head release-package-title"><div><div className="panel-title"><span className="release-version-mark">版本</span>{release.version} <span className={`badge ${release.status === "已发布" ? "green" : "amber"}`}>{request?.status ?? release.status}</span></div><div className="panel-sub">Build {release.buildNumber} · {release.channel} · 共 {files.length} 个文件</div></div><div className="row-actions">{isAdmin && release.status === "已发布" && release.channel === "小范围试用" && <button disabled={busy} className="btn small primary" onClick={() => onPromoteTrial(release)}>转为正式发布</button>}{canUpload && canEditRelease && !request && <><button className="btn small" onClick={() => onUploadFirmware(release)}>上传文件</button><button className="btn small ghost" onClick={() => onEditVersion(release)}>编辑版本</button>{release.status === "草稿" && <button disabled={busy || files.length === 0} className="btn small primary" onClick={() => onStatus(release, "测试中")}>开始自测</button>}{release.status === "测试中" && <><button disabled={busy} className="btn small ghost" onClick={() => onStatus(release, "草稿")}>退回草稿</button><button disabled={busy || files.length === 0} className="btn small primary" onClick={() => onPublish(release)}>提交测试</button></>}</>}</div></div>
          {isAdmin && release.status === "已发布" && release.channel === "正式发布" && <div className="row-actions" style={{ justifyContent: "flex-end", margin: "-8px 0 12px" }}><button disabled={busy} className="btn small" onClick={() => onPromoteTrial(release)}>改为小范围试用</button></div>}
          <ReleaseWorkflow release={release} request={request} />
          {canUpload && release.status === "开发自测" && !request && <div className="release-selftest-actions"><span>开发自测完成后，可提交给测试工程师。</span><div className="row-actions"><button disabled={busy} className="btn small ghost" onClick={() => onStatus(release, "草稿")}>退回草稿</button><button disabled={busy || files.length === 0} className="btn small primary" onClick={() => onPublish(release)}>提交测试</button></div></div>}
          {release.expectedKinds && <div className="release-package-requirements"><strong>本版本必需文件</strong>{release.expectedKinds.split(",").map((kind) => <span className="badge" key={kind}>{artifactGroupLabel(kind)}</span>)}</div>}
          <div className="release-facts"><div><span>支持硬件</span><strong>{release.hardwareScope || "未绑定"}</strong></div><div><span>协议绑定</span><strong>{release.protocolBindings || "未绑定"}</strong></div><div><span>最低升级版本</span><strong>{release.minUpgradeVersion || "无限制"}</strong></div><div><span>降级策略</span><strong>{release.allowDowngrade ? "允许降级" : "禁止降级"}</strong></div></div>
          <div className="release-copy"><div><strong>更新说明</strong><p>{release.releaseNotes || "尚未填写"}</p></div><div><strong>已知问题</strong><p>{release.knownIssues || "无"}</p><button className="btn small ghost" disabled={busy} onClick={() => onEditKnownIssues(release)}>编辑已知问题</button></div>{testReports.length > 0 && <div><strong>测试报告</strong>{testReports.map((report) => <button className="attachment-line file-button" key={report.id} onClick={() => onDownload(report)}>{report.name} · {report.uploadedBy} · {formatSize(report.size)}</button>)}</div>}</div>
          <FirmwareBundleFiles files={files} release={release} assetTypes={selectedAssets} canDownload={canDownloadPending} canUpload={canUpload} canDirectEdit={canUpload && release.status === "草稿" && !request} onDownload={onDownload} onRemove={onDeleteArtifact} onReplace={onReplace} onUpload={onUploadFirmware} />
        </section>;
      })}
      {(focusedReleaseId ? !releases.some((item) => item.id === focusedReleaseId) : releases.length === 0) && <div className="panel empty">{focusedReleaseId ? "该测试版本暂不可用，请返回测试工作台刷新后重试。" : "尚未创建固件版本"}</div>}
    </>}
    {tab === "protocols" && <><div className="page-head workspace-actions"><div><h1 style={{ fontSize: 19 }}>产品通信协议</h1><p>先新建协议版本，再在对应协议卡片上传附件。</p></div>{canUpload && <div className="actions"><button className="btn primary" onClick={onCreateProtocol}>＋ 新建协议版本</button></div>}</div><div className="protocol-grid">{protocols.map((item) => { const files = protocolFiles.filter((file) => file.protocolId === item.id); return <div className="resource-card" key={item.id}><div className="product-top"><span className="badge">{item.interfaceType}</span><span className={`badge ${item.status === "已发布" ? "green" : "amber"}`}>{item.status}</span></div><h3>{item.name} <span className="code">{item.version}</span></h3><p>{item.description || "暂无说明"}</p>{files.length > 0 && <div className="file-list">{files.map((file) => <button className="attachment-line file-button" key={file.id} onClick={() => onDownloadFile(`/api/protocols/files/${file.id}/download`, file.fileName)}>{file.fileName} · {formatSize(file.size)}</button>)}</div>}{canUpload && <div className="card-actions"><button className="btn small primary" onClick={() => onUploadProtocol(item)}>上传附件</button><button className="btn small ghost" onClick={() => onEditProtocol(item)}>编辑</button><button className="btn small danger" disabled={busy || files.length > 0} title={files.length ? "已有附件，不能删除" : "删除空协议"} onClick={() => onDeleteProtocol(item)}>删除</button></div>}</div>; })}{protocols.length === 0 && <div className="panel empty"><strong>该产品还没有通信协议</strong><p>请先创建协议版本，创建后即可在该协议卡片上传附件。</p>{canUpload && <button className="btn primary" onClick={onCreateProtocol}>创建第一个协议版本</button>}</div>}</div></>}
    {tab === "tools" && <div className="tool-grid">{tools.map((item) => { const files = toolFiles.filter((file) => file.toolId === item.id); return <div className="resource-card" key={item.id}><span className="badge">{item.platform}</span><h3>{item.name} <span className="code">{item.version}</span></h3><p>{item.description || "暂无说明"}</p>{files.map((file) => <button className="attachment-line file-button" key={file.id} onClick={() => onDownloadFile(`/api/tools/files/${file.id}/download`, file.fileName)}>{file.fileName}</button>)}</div>; })}{tools.length === 0 && <div className="panel empty"><strong>该产品还没有关联工具</strong><p>请到“工具管理”选择工具并手动关联当前产品。</p></div>}</div>}
    {canManageProduct && tab === "settings" && <><section className="panel"><div className="panel-head"><div><div className="panel-title">产品设置</div><div className="panel-sub">修改产品资料范围与基础信息</div></div></div><div className="panel-body"><div className="actions"><button className="btn" onClick={onEdit}>编辑产品</button>{isAdmin && <button className="btn danger" onClick={onDelete}>{releases.length + protocols.length + artifacts.length + tools.length > 0 ? "强制删除产品" : "删除空产品"}</button>}</div></div></section>{isAdmin && <section className="panel management-panel"><div className="panel-head"><div><div className="panel-title">管理信息</div><div className="panel-sub">成员范围与最近操作</div></div></div><div className="management-columns"><div><strong>可协作成员</strong><div className="member-summary">{memberRows.map((user) => <span className="badge" key={user.email}>{user.displayName} · {roleLabel(user.role)}</span>)}</div></div><div><strong>最近操作</strong><div className="activity-list compact-activity">{productAudits.slice(0, 3).map((item) => <Activity key={item.id} mark="记" text={formatAuditDetail(item.detail)} actor={item.actorEmail === "系统所有者" ? "admin" : users.find((user) => user.email.toLowerCase() === item.actorEmail.toLowerCase())?.displayName ?? item.actorEmail} time={formatDateTime(item.createdAt)} />)}{productAudits.length === 0 && <span className="text-muted">暂无操作记录</span>}</div></div></div></section>}</>}
  </>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyProductDetail({ product, releases, latest, artifacts, protocols, hardwareVariants, assetTypes, canUpload, isAdmin, onBack, onEdit, onDelete, onReplace, onPublish, onNewVersion, onDownload }: { product: Product; releases: Release[]; latest?: Release; artifacts: Artifact[]; protocols: Protocol[]; hardwareVariants: HardwareVariant[]; assetTypes: AssetType[]; canUpload: boolean; isAdmin: boolean; onBack: () => void; onEdit: () => void; onDelete: () => void; onReplace: () => void; onPublish: () => void; onNewVersion: () => void; onDownload: (artifact: Artifact) => void }) {
  return <><button className="back" onClick={onBack}>← 返回产品列表</button><div className="detail-banner"><div><div className="eyebrow" style={{ color: "#7fe0cc" }}>{product.code} · {product.family}</div><h2>{product.name}</h2><p>{product.description}</p></div><div className="detail-stats"><div><span>当前稳定版</span><strong>{latest?.version ?? "—"}</strong></div><div><span>硬件版本</span><strong>{product.hwVersions}</strong></div><div><span>负责人</span><strong>{product.owner}</strong></div></div></div>
    <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><div><div className="panel-title">硬件版本</div><div className="panel-sub">固件上传和下载时以硬件兼容性为准</div></div><span className="badge">{assetTypes.length} 类资产</span></div><div className="table-wrap"><table><thead><tr><th>硬件版本</th><th>MCU / SoC</th><th>Flash / RAM</th><th>PCB</th><th>最低 Bootloader</th><th>通信接口</th></tr></thead><tbody>{hardwareVariants.map((item) => <tr key={item.id}><td className="cell-main code">{item.code}</td><td>{item.mcu}</td><td>{item.flashSize} / {item.ramSize}</td><td>{item.pcbVersion}</td><td>{item.minBootloader}</td><td>{item.interfaces}</td></tr>)}</tbody></table></div></section>
    <div className="page-head"><div><h1 style={{ fontSize: 19 }}>版本资产</h1><p>当前生效文件、校验值与通信协议绑定关系。</p></div><div className="actions">{isAdmin && <><button className="btn" onClick={onEdit}>编辑产品信息</button><button className="btn danger" disabled={releases.length + protocols.length + artifacts.length > 0} title={releases.length + protocols.length + artifacts.length ? "存在关联资料，不能删除" : "删除空产品"} onClick={onDelete}>删除空产品</button></>}{canUpload && <><button className="btn" onClick={onNewVersion}>＋ 新建固件版本</button>{latest && artifacts.some((item) => item.active) && <button className="btn danger" onClick={onReplace}>申请替换文件</button>}{latest && <button className="btn primary" onClick={onPublish}>提交正式发布</button>}</>}</div></div>
    {latest ? <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><div><div className="panel-title">{latest.version} <span className={`badge ${latest.status === "已发布" ? "green" : "amber"}`} style={{ marginLeft: 8 }}>{latest.status}</span></div><div className="panel-sub">Bootloader {latest.bootloaderVersion} · APP {latest.appVersion} · Build {latest.buildNumber}</div></div><span className="code">{latest.releaseDate}</span></div><div className="table-wrap"><table><thead><tr><th>资产类型</th><th>文件名</th><th>修订</th><th>大小</th><th>SHA-256</th><th>状态</th><th></th></tr></thead><tbody>{artifacts.map((item) => <tr key={item.id}><td><span className="badge">{item.kind}</span></td><td className="cell-main">{item.name}</td><td>{item.revision}</td><td>{formatSize(item.size)}</td><td className="code">{item.sha256}</td><td><span className={`badge ${item.active ? "green" : ""}`}><span className="dot" />{item.active ? "生效" : item.status}</span></td><td>{item.active && <button className="btn small" onClick={() => onDownload(item)}>下载</button>}</td></tr>)}{artifacts.length === 0 && <tr><td colSpan={7}><div className="empty compact">该版本还没有上传固件文件</div></td></tr>}</tbody></table></div></section> : <div className="panel empty"><strong>尚未创建固件版本</strong><p>先创建版本和构建号，再上传 APP、Bootloader、OTA 或线刷包。</p>{canUpload && <button className="btn primary" onClick={onNewVersion}>创建首个固件版本</button>}</div>}
    <div className="grid-2"><section className="panel"><div className="panel-head"><div><div className="panel-title">绑定的通信协议</div><div className="panel-sub">固件与协议版本的明确对应关系</div></div></div><div className="table-wrap"><table style={{ minWidth: 520 }}><thead><tr><th>协议</th><th>接口</th><th>版本</th><th>状态</th></tr></thead><tbody>{protocols.map((item) => <tr key={item.id}><td className="cell-main">{item.name}</td><td>{item.interfaceType}</td><td className="code">{item.version}</td><td><span className="badge green">{item.status}</span></td></tr>)}</tbody></table></div></section><section className="panel"><div className="panel-head"><div className="panel-title">升级约束</div></div><div className="panel-body"><div className="activity-list"><Activity mark="HW" text={`支持硬件：${product.hwVersions}`} time="不兼容型号禁止使用" /><Activity mark="BL" text={`最低 Bootloader：${latest?.bootloaderVersion ?? "—"}`} time="升级前自动校验" /><Activity mark="↓" text="默认禁止降级" time="管理员可针对指定设备授权" /></div></div></section></div>
    {releases.length > 1 && <section className="panel" style={{ marginTop: 18 }}><div className="panel-head"><div className="panel-title">历史版本</div></div></section>}
  </>;
}

function Protocols({ protocols, products, files, canUpload, busy, onCreate, onUpload, onEdit, onDelete, onDownload }: { protocols: Protocol[]; products: Product[]; files: ProtocolFile[]; canUpload: boolean; busy: boolean; onCreate: () => void; onUpload: (protocol: Protocol) => void; onEdit: (protocol: Protocol) => void; onDelete: (protocol: Protocol) => void; onDownload: (file: ProtocolFile) => void }) {
  return <><div className="page-head"><div><div className="eyebrow">Protocol Library</div><h1>协议管理</h1><p>维护接口定义、帧格式、命令字、错误码和协议附件。</p></div>{canUpload && <button className="btn primary" onClick={onCreate}>＋ 新建协议</button>}</div>{protocols.length === 0 ? <div className="panel empty"><strong>还没有通信协议</strong><p>先建立协议版本，再上传接口文档、DBC、寄存器表等附件。</p>{canUpload && <button className="btn primary" onClick={onCreate}>创建第一个协议</button>}</div> : <div className="protocol-grid">{protocols.map((item) => { const attachments = files.filter((file) => file.protocolId === item.id); return <div className="resource-card" key={item.id}><div className="product-top"><span className="badge">{item.interfaceType}</span><span className={`badge ${item.status === "已发布" ? "green" : "amber"}`}>{item.status}</span></div><h3>{item.name} <span className="code">{item.version}</span></h3><p>{item.description || "暂无协议说明"}</p>{attachments.length > 0 && <div className="file-list">{attachments.map((file) => <button className="attachment-line file-button" key={file.id} onClick={() => onDownload(file)}>{file.fileName} · {formatSize(file.size)}</button>)}</div>}<div className="resource-foot"><span>{products.find((p) => p.id === item.productId)?.name}</span><span>{attachments.length} 个附件 · 更新于 {item.updatedAt}</span></div>{canUpload && <div className="card-actions"><button className="btn small" onClick={() => onUpload(item)}>上传附件</button><button className="btn small ghost" onClick={() => onEdit(item)}>编辑</button><button className="btn small danger" disabled={busy || attachments.length > 0} title={attachments.length ? "已有附件，不能删除" : "删除空协议"} onClick={() => onDelete(item)}>删除</button></div>}</div>; })}</div>}</>;
}

function Tools({ tools, files, canUpload, busy, onCreate, onUpload, onEdit, onDelete, onDownload }: { tools: Tool[]; files: ToolFile[]; canUpload: boolean; busy: boolean; onCreate: () => void; onUpload: (tool: Tool) => void; onEdit: (tool: Tool) => void; onDelete: (tool: Tool) => void; onDownload: (file: ToolFile) => void }) {
  return <><div className="page-head"><div><div className="eyebrow">Engineering Toolkit</div><h1>工具管理</h1><p>工具和安装包独立保存，需要时再手动关联一个或多个产品。</p></div>{canUpload && <button className="btn primary" onClick={onCreate}>＋ 新建独立工具</button>}</div>{tools.length === 0 ? <div className="panel empty"><strong>还没有烧录或调试工具</strong><p>先建立独立工具并上传文件，之后可随时关联产品。</p>{canUpload && <button className="btn primary" onClick={onCreate}>创建第一个工具</button>}</div> : <div className="tool-grid">{tools.map((item) => { const attachments = files.filter((file) => file.toolId === item.id); return <div className="resource-card" key={item.id}><div className="product-top"><span className="badge">{item.platform}</span><span className="badge green">{item.status}</span></div><h3>{item.name} <span className="code">{item.version}</span></h3><p>{item.description || "暂无工具说明"}</p>{attachments.length > 0 && <div className="file-list">{attachments.map((file) => <button className="attachment-line file-button" key={file.id} onClick={() => onDownload(file)}>{file.fileName} · {formatSize(file.size)}</button>)}</div>}<div className="resource-foot"><span>{item.productScope || "暂未关联产品"}</span><span>{attachments.length} 个文件 · 更新于 {item.updatedAt}</span></div>{canUpload && <div className="card-actions"><button className="btn small" onClick={() => onUpload(item)}>上传文件</button><button className="btn small ghost" onClick={() => onEdit(item)}>编辑与关联</button><button className="btn small danger" disabled={busy} title={attachments.length ? "删除时会要求确认，并同时删除附件" : "删除工具"} onClick={() => onDelete(item)}>删除</button></div>}</div>; })}</div>}</>;
}

const priorityRank: Record<string, number> = { "紧急": 0, "高": 1, "普通": 2, "低": 3 };

function TestingWorkbench({ releases, artifacts, currentUser, busy, onOpenPackage, onAction }: { releases: ReleaseRequest[]; artifacts: Artifact[]; currentUser: CurrentUser; busy: boolean; onOpenPackage: (productId: string, releaseId: string) => void; onAction: (id: string, action: WorkflowAction) => void }) {
  const tasks = releases.filter((item) => ["待领取", "测试中"].includes(item.status)).sort((a, b) => (priorityRank[a.priority ?? "普通"] ?? 2) - (priorityRank[b.priority ?? "普通"] ?? 2) || a.createdAt.localeCompare(b.createdAt));
  const mine = tasks.filter((item) => item.assignedTesterEmail?.toLowerCase() === currentUser.email.toLowerCase());
  const pool = tasks.filter((item) => item.status === "待领取");
  const processing = tasks.filter((item) => item.status === "测试中" && !mine.includes(item));
  const completed = releases.filter((item) => item.assignedTesterEmail?.toLowerCase() === currentUser.email.toLowerCase() && Boolean(item.testResult) && !["待领取", "测试中"].includes(item.status)).slice(0, 10);
  const card = (item: ReleaseRequest) => {
    const isMine = item.assignedTesterEmail?.toLowerCase() === currentUser.email.toLowerCase();
    const canHandle = currentUser.isAdmin || isMine;
    const priorityClass = item.priority === "紧急" ? "red" : item.priority === "高" ? "amber" : "";
    return <div className="approval-card test-task" key={item.id}><div className="approval-head"><div><div className="approval-kind">{item.productName ?? item.productId}</div><h3>{item.releaseVersion ?? item.releaseId}</h3><p>{item.summary}</p></div><div className="task-badges"><span className={`badge ${priorityClass}`}>{item.priority ?? "普通"}</span><span className="badge amber">{item.status}</span></div></div><div className="approval-meta"><div><span>提交人</span><strong>{item.requester}</strong></div><div><span>提交时间</span><strong>{formatDateTime(item.createdAt)}</strong></div><div><span>期望完成</span><strong>{item.expectedAt ? formatDateTime(item.expectedAt) : "未设置"}</strong></div><div><span>测试工程师</span><strong>{item.assignedTesterName || "待领取"}</strong></div></div><div className="approval-actions"><button className="btn small ghost" onClick={() => onOpenPackage(item.productId, item.releaseId)}>查看版本包</button>{item.status === "待领取" && <button disabled={busy} className="btn primary" onClick={() => onAction(item.id, "claim")}>领取并开始测试</button>}{item.status === "测试中" && canHandle && <><button disabled={busy} className="btn ghost" onClick={() => onAction(item.id, "unclaim")}>退回任务池</button><button disabled={busy} className="btn" onClick={() => onAction(item.id, "fail")}>测试不通过</button><button disabled={busy} className="btn primary" onClick={() => onAction(item.id, "pass")}>测试通过，提交审核</button></>}</div></div>;
  };
  return <><div className="page-head"><div><div className="eyebrow">Test Workspace</div><h1>测试工作台</h1><p>先领取任务，再查看版本包并填写测试结论。</p></div></div><div className="workflow-metrics"><div><span>我的测试</span><strong>{mine.length}</strong></div><div><span>待领取</span><strong>{pool.length}</strong></div><div><span>全部进行中</span><strong>{processing.length}</strong></div></div>{mine.length > 0 && <><div className="section-intro"><strong>我的测试</strong><span>{mine.length} 项需要处理</span></div>{mine.map(card)}</>}{pool.length > 0 && <><div className="section-intro"><strong>待领取</strong><span>按优先级排序</span></div>{pool.map(card)}</>}{processing.length > 0 && <><div className="section-intro"><strong>其他人进行中</strong></div>{processing.map(card)}</>}{tasks.length === 0 && <div className="panel empty">当前没有测试任务</div>}{completed.length > 0 && <section className="panel workflow-history"><div className="panel-head"><div className="panel-title">最近完成</div></div><div className="table-wrap"><table><thead><tr><th>产品</th><th>版本</th><th>结果</th><th>测试报告</th><th>完成时间</th><th>当前状态</th></tr></thead><tbody>{completed.map((item) => { const reports = artifacts.filter((artifact) => artifact.releaseRequestId === item.id && artifact.kind === "测试报告"); return <tr key={item.id}><td>{item.productName}</td><td>{item.releaseVersion}</td><td>{item.testResult}</td><td>{reports.length ? reports.map((report) => <button className="text-button" key={report.id} onClick={() => { void startDownload(`/api/artifacts/${report.id}/download`, report.name); }}>{report.name}</button>) : "未上传"}</td><td>{formatDateTime(item.testedAt)}</td><td><span className="badge">{item.status}</span></td></tr>; })}</tbody></table></div></section>}</>;
}

function Approvals({ replacements, releases, artifacts, currentUser, canApprove, busy, onDecision }: { replacements: Replacement[]; releases: ReleaseRequest[]; artifacts: Artifact[]; currentUser: CurrentUser; canApprove: boolean; busy: boolean; onDecision: (id: string, action: "approve" | "reject", kind: "replacement" | "release") => void }) {
  const pendingReplacements = replacements.filter((item) => item.status === "待审批");
  const pendingReleases = releases.filter((item) => ["待审核", "待终审"].includes(item.status));
  const finalReview = pendingReleases.filter((item) => item.status === "待终审");
  const history = releases.filter((item) => ["已批准", "已驳回"].includes(item.status)).slice(0, 10);
  return <><div className="page-head"><div><div className="eyebrow">Release Approval</div><h1>审批中心</h1><p>测试通过后进入审核；管理员可直接完成最终发布。</p></div></div><div className="workflow-metrics"><div><span>固件待审核</span><strong>{pendingReleases.length - finalReview.length}</strong></div><div><span>待终审</span><strong>{finalReview.length}</strong></div><div><span>文件替换</span><strong>{pendingReplacements.length}</strong></div></div>
    {pendingReleases.length > 0 && <div className="section-intro"><strong>固件发布审批</strong><span>测试结论和测试报告随版本申请一并查看</span></div>}{pendingReleases.map((item) => { const canHandle = item.status === "待终审" ? currentUser.isAdmin : canApprove; const reports = artifacts.filter((artifact) => artifact.releaseRequestId === item.id && artifact.kind === "测试报告"); return <div className="approval-card release-approval" key={item.id}><div className="approval-head"><div><div className="approval-kind">固件发布</div><h3>{item.productName ?? item.productId} · {item.releaseVersion ?? item.releaseId}</h3><p>{item.summary}</p></div><span className="badge amber">{item.status}</span></div><div className="approval-meta"><div><span>测试结论</span><strong>{item.testResult} · {item.testedBy}</strong></div><div><span>测试记录</span><strong>{item.testNotes || "—"}</strong></div><div><span>测试报告</span><strong>{reports.length ? reports.map((report) => <button className="text-button" key={report.id} onClick={() => { void startDownload(`/api/artifacts/${report.id}/download`, report.name); }}>{report.name}</button>) : "未上传"}</strong></div><div><span>审核记录</span><strong>{item.firstReviewedBy ? `${item.firstReviewedBy} · ${formatDateTime(item.firstReviewedAt)}` : "待审核"}</strong></div><div><span>申请人</span><strong>{item.requester}</strong></div></div>{canHandle && <div className="approval-actions"><button disabled={busy} className="btn" onClick={() => onDecision(item.id, "reject", "release")}>退回修改</button><button disabled={busy} className="btn primary" onClick={() => onDecision(item.id, "approve", "release")}>{item.status === "待终审" ? "终审并发布" : currentUser.isAdmin ? "直接批准发布" : "审核通过，送终审"}</button></div>}</div>; })}
    {pendingReplacements.length > 0 && <div className="section-intro"><strong>文件替换审批</strong></div>}{pendingReplacements.map((item) => <div className="approval-card" key={item.id}><div className="approval-head"><div><div className="approval-kind">文件替换</div><h3>{item.productName ?? item.productId} · {item.releaseVersion ?? item.releaseId}</h3><p>{item.reason}</p></div><span className="badge amber">待审批</span></div><div className="approval-meta"><div><span>目标文件</span><strong className="code">{item.artifactName}</strong></div><div><span>修订变更</span><strong>{item.currentRevision} → {item.newRevision}</strong></div><div><span>影响范围</span><strong>{item.impact}</strong></div><div><span>申请人</span><strong>{item.requester}</strong></div></div>{canApprove && <div className="approval-actions"><button disabled={busy} className="btn" onClick={() => onDecision(item.id, "reject", "replacement")}>驳回</button><button disabled={busy} className="btn primary" onClick={() => onDecision(item.id, "approve", "replacement")}>批准并生效</button></div>}</div>)}
    {pendingReplacements.length + pendingReleases.length === 0 && <div className="panel empty">当前没有待审批事项</div>}{history.length > 0 && <section className="panel workflow-history"><div className="panel-head"><div className="panel-title">最近审批</div></div><div className="table-wrap"><table><thead><tr><th>产品</th><th>版本</th><th>状态</th><th>处理人</th><th>处理时间</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.productName}</td><td>{item.releaseVersion}</td><td><span className={`badge ${item.status === "已批准" ? "green" : "red"}`}>{item.status}</span></td><td>{item.reviewedBy || item.firstReviewedBy || "—"}</td><td>{formatDateTime(item.reviewedAt || item.firstReviewedAt)}</td></tr>)}</tbody></table></div></section>}
  </>;
}

function DecisionModal({ decision, busy, users, onClose, onSubmit }: { decision: WorkflowDecision; busy: boolean; users: Member[]; onClose: () => void; onSubmit: (note: string, report?: File | null, scope?: "trial" | "formal", trialMembers?: string[]) => void }) {
  const [scope, setScope] = useState<"trial" | "formal">("formal");
  const requiresNote = decision.action === "pass" || decision.action === "fail" || decision.action === "reject";
  const title = decision.action === "pass" ? "提交测试通过" : decision.action === "fail" ? "提交测试不通过" : decision.action === "reject" ? "驳回申请" : "确认审批通过";
  const isTestDecision = decision.kind === "release" && (decision.action === "pass" || decision.action === "fail");
  const isReleaseApproval = decision.kind === "release" && decision.action === "approve";
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="modal decision-modal" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const members = form.getAll("trialMemberEmails").map(String); if (isReleaseApproval && scope === "trial" && members.length === 0) { window.alert("小范围试用至少选择一位同事"); return; } const report = form.get("report"); onSubmit(String(form.get("note") ?? ""), report instanceof File && report.size > 0 ? report : null, scope, members); }}><div className="modal-head"><h2>{title}</h2><button type="button" className="close" onClick={onClose} aria-label="关闭">×</button></div><div className="form">{isReleaseApproval && <div className="field"><label>发布范围 *</label><div className="check-grid"><label className="check-card"><input type="radio" name="scope" value="trial" checked={scope === "trial"} onChange={() => setScope("trial")} /><span><strong>小范围试用</strong><small>仅指定同事及产品协作成员可查看和下载。</small></span></label><label className="check-card"><input type="radio" name="scope" value="formal" checked={scope === "formal"} onChange={() => setScope("formal")} /><span><strong>正式发布</strong><small>在产品目录中公开展示，文件下载仍遵循产品协作权限。</small></span></label></div>{scope === "trial" && <><label className="field-label">选择试用同事 *（至少一位）</label><div className="trial-member-list">{users.filter((user) => user.status === "active").map((user) => <label key={user.email}><input type="checkbox" name="trialMemberEmails" value={user.email} /><span>{user.displayName}</span><small>{user.email}</small></label>)}{users.filter((user) => user.status === "active").length === 0 && <small>当前没有可选同事，请由管理员进行终审。</small>}</div></>}<small>名单之外的同事不会看到或下载这个试用版本。</small></div>}<div className="field"><label>{decision.action === "reject" ? "驳回原因" : decision.action === "approve" ? "审批意见" : "测试结论"}</label><textarea name="note" required={requiresNote} autoFocus /></div>{isTestDecision && <div className="field"><label>测试报告（可选）</label><input name="report" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,.md,.png,.jpg,.jpeg" /><small>上传后会随本次测试结论保存，供开发和审核人员下载查看。</small></div>}</div><div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button><button disabled={busy} className="btn primary" type="submit">确认</button></div></form></div>;
}

function SettingsPanel({ currentUser, uploadMaxMb, busy, onClose, onSaveUploadLimit }: { currentUser: CurrentUser; uploadMaxMb: number; busy: boolean; onClose: () => void; onSaveUploadLimit: (value: number) => void }) {
  const [maxMb, setMaxMb] = useState(String(uploadMaxMb));
  return <div className="modal-backdrop" role="presentation"><div className="modal settings-panel" role="dialog" aria-modal="true" aria-label="设置"><div className="modal-head"><div><h2>设置</h2><p>{currentUser.isAdmin ? "平台与个人设置" : "个人设置"}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div><div className="modal-body settings-content"><section><h3>个人设置</h3><button className="settings-row" onClick={() => { window.location.assign("/change-password"); }}><span><strong>修改密码</strong><small>更新当前账号的登录密码</small></span><b>›</b></button></section>{currentUser.isAdmin && <section><h3>平台设置</h3><div className="settings-row static"><span><strong>单文件上传上限</strong><small>适用于固件、产品资料、协议和工具附件</small></span><div className="settings-input"><input type="number" min="10" max="1024" value={maxMb} onChange={(event) => setMaxMb(event.target.value)} /><span>MB</span><button className="btn small primary" disabled={busy} onClick={() => onSaveUploadLimit(Number(maxMb))}>保存</button></div></div></section>}</div></div></div>;
}

function Materials({ materials, requests, stats, currentUser, busy, onPublish, onRequest, onEdit, onResolve, onCancel, onStatus }: { materials: Material[]; requests: MaterialRequest[]; stats: Catalog["materialStats"]; currentUser: CurrentUser; busy: boolean; onPublish: () => void; onRequest: (material: Material) => void; onEdit: (material: Material) => void; onResolve: (id: string, action: "approve" | "reject") => void; onCancel: (id: string) => void; onStatus: (material: Material, status: "已下架" | "可领用") => void }) {
  const [tab, setTab] = useState<"square" | "published" | "requested">("square");
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState("全部");
  const [bomMatcherOpen, setBomMatcherOpen] = useState(false);
  const currentEmail = currentUser.email.toLowerCase();
  const categories = ["全部", "模块", "芯片", "传感器", "PCB", "线材", "其他"];
  const visibleMaterials = materials.filter((item) => (tab === "published" ? item.publisherEmail.toLowerCase() === currentEmail : true) && (category === "全部" || item.category === category) && `${item.name} ${item.category} ${item.note}`.toLowerCase().includes(keyword.trim().toLowerCase()));
  const outgoing = requests.filter((item) => item.requesterEmail.toLowerCase() === currentEmail);
  const incoming = requests.filter((item) => item.publisherEmail.toLowerCase() === currentEmail || currentUser.isAdmin);
  const pendingIncoming = incoming.filter((item) => item.status === "待确认");
  return <>
    <div className="page-head"><div><div className="eyebrow">Material Share</div><h1>研发物料</h1><p>发布样机剩余物料，让需要的同事直接联系并申请领用。</p></div><div className="actions"><button className="btn" onClick={() => setBomMatcherOpen(true)}>AI 匹配 BOM</button><button className="btn primary" onClick={onPublish}>＋ 发布物料</button></div></div>
    <div className="material-summary" aria-label="研发物料统计"><div><span>累计共享</span><strong>{stats.sharedQuantity.toLocaleString("zh-CN")} 个</strong></div><div><span>已节约成本</span><strong>{formatCurrency(stats.savedCost)}</strong><small>按已同意领用数量 × 发布预估单价累计</small></div></div>
    <div className="material-tabs"><button className={tab === "square" ? "active" : ""} onClick={() => setTab("square")}>物料广场 <span>{materials.filter((item) => item.status === "可领用").length}</span></button><button className={tab === "published" ? "active" : ""} onClick={() => setTab("published")}>我的发布</button><button className={tab === "requested" ? "active" : ""} onClick={() => setTab("requested")}>我的领用 {pendingIncoming.length > 0 && <span>{pendingIncoming.length}</span>}</button></div>
    {tab !== "requested" && <><div className="material-filter"><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索型号、名称或备注" aria-label="搜索研发物料" /><div>{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div></div><div className="material-grid">{visibleMaterials.map((material) => { const isMine = material.publisherEmail.toLowerCase() === currentEmail; const canManage = isMine || currentUser.isAdmin; const requestableQuantity = Math.max(0, material.availableQuantity - Number(material.reservedQuantity ?? 0)); const canRequest = material.status === "可领用" && !isMine && requestableQuantity > 0; return <article className={`material-card ${material.status !== "可领用" ? "muted" : ""}`} key={material.id}><div className="material-card-head"><span className="material-category">{material.category}</span><span className={`badge ${material.status === "可领用" ? "green" : material.status === "已领完" ? "amber" : ""}`}>{material.status}</span></div><h3>{material.name}</h3><div className="material-count"><strong>{requestableQuantity}</strong><span>个可申请</span>{Number(material.reservedQuantity ?? 0) > 0 && <small>{material.reservedQuantity} 个待确认</small>}{material.quantity !== material.availableQuantity && <small>原有 {material.quantity} 个</small>}</div><div className="material-price"><span>预估单价</span><strong>{formatCurrency(material.estimatedUnitPrice)}</strong><small>{material.estimatedUnitPrice > 0 ? "/ 个" : "未填写"}</small></div>{material.note && <p>{material.note}</p>}<div className="material-owner"><span>发布人</span><strong>{material.publisherName}</strong><small>{formatUpdateTime(material.updatedAt)}</small></div><div className="card-actions">{canRequest && <button className="btn small primary" disabled={busy} onClick={() => onRequest(material)}>我要领用</button>}{canManage && <button className="btn small" disabled={busy} onClick={() => onEdit(material)}>编辑物料</button>}{canManage && material.status !== "已下架" && <button className="btn small danger" disabled={busy} onClick={() => onStatus(material, "已下架")}>下架</button>}{canManage && material.status === "已下架" && material.availableQuantity > 0 && <button className="btn small" disabled={busy} onClick={() => onStatus(material, "可领用")}>重新开放</button>}{!canRequest && !canManage && <span className="text-muted">{requestableQuantity === 0 ? "待确认数量已占用" : `联系 ${material.publisherName} 领取`}</span>}</div></article>; })}</div>{visibleMaterials.length === 0 && <div className="panel empty"><strong>{tab === "published" ? "您还没有发布物料" : "暂时没有符合条件的研发物料"}</strong><p>{tab === "published" ? "样机剩余的模块、芯片或线材都可以快速发布。" : "换个关键词，或稍后再来看看。"}</p>{tab === "published" && <button className="btn primary" onClick={onPublish}>发布第一条物料</button>}</div>}</>}
    {tab === "requested" && <div className="material-request-layout"><section className="panel"><div className="panel-head"><div><div className="panel-title">待我确认</div><div className="panel-sub">同事申请领用您发布的物料</div></div><span className="badge amber">{pendingIncoming.length} 条</span></div><div className="request-list">{pendingIncoming.map((item) => <div className="request-row" key={item.id}><div><strong>{item.requesterName} 申请 {item.materialName}</strong><p>数量：{item.quantity} 个{item.note ? ` · ${item.note}` : ""}</p><small>{formatDateTime(item.createdAt)}</small></div><div className="approval-actions"><button className="btn small danger" disabled={busy} onClick={() => onResolve(item.id, "reject")}>拒绝</button><button className="btn small primary" disabled={busy} onClick={() => onResolve(item.id, "approve")}>同意</button></div></div>)}{pendingIncoming.length === 0 && <div className="empty compact">暂无需要确认的领用申请</div>}</div></section><section className="panel"><div className="panel-head"><div><div className="panel-title">我的申请</div><div className="panel-sub">申请获同意后，请联系发布人领取</div></div></div><div className="request-list">{outgoing.map((item) => <div className="request-row" key={item.id}><div><strong>{item.materialName} · {item.quantity} 个</strong><p>发布人：{item.publisherName}{item.note ? ` · ${item.note}` : ""}</p><small>{formatDateTime(item.createdAt)}</small></div><div className="approval-actions"><span className={`badge ${item.status === "已同意" ? "green" : item.status === "待确认" ? "amber" : "red"}`}>{item.status}</span>{item.status === "待确认" && <button className="btn small" disabled={busy} onClick={() => onCancel(item.id)}>撤销</button>}</div></div>)}{outgoing.length === 0 && <div className="empty compact">您还没有申请过物料</div>}</div></section></div>}
    {bomMatcherOpen && <BomMatcher materials={materials} busy={busy} onClose={() => setBomMatcherOpen(false)} onRequest={(material) => { setBomMatcherOpen(false); onRequest(material); }} />}
  </>;
}

function BomMatcher({ materials, busy, onClose, onRequest }: { materials: Material[]; busy: boolean; onClose: () => void; onRequest: (material: Material) => void }) {
  const [text, setText] = useState("");
  const [matching, setMatching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<BomMatchRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const matchedCount = rows.filter((row) => row.suggestions.length > 0).length;
  async function importBomFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("BOM 文件不能超过 5 MB"); return; }
    setImporting(true); setError("");
    try {
      let content: string;
      if (/\.(csv|txt)$/i.test(file.name)) {
        content = await file.text();
      } else {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!firstSheet) throw new Error("Excel 文件中没有可读取的工作表");
        content = XLSX.utils.sheet_to_csv(firstSheet, { FS: "\t", RS: "\n", blankrows: false });
      }
      if (!content.trim()) throw new Error("文件中没有可读取的表格内容");
      setText(content.split(/\r?\n/).filter(Boolean).slice(0, 50).join("\n"));
      setRows([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Excel 文件读取失败，请检查文件格式"); }
    finally { setImporting(false); }
  }
  async function match() {
    if (!text.trim()) { setError("请先粘贴 BOM 表或物料清单"); return; }
    setMatching(true); setError("");
    try {
      const response = await authFetch("/api/materials/bom-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "匹配暂时无法完成");
      setRows(result.rows ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "匹配暂时无法完成"); }
    finally { setMatching(false); }
  }
  return <div className="modal-backdrop" role="presentation"><div className="modal modal-wide bom-modal" role="dialog" aria-modal="true" aria-label="AI 匹配 BOM"><div className="modal-head"><div><h2>AI 匹配 BOM</h2><p>选择 Excel 文件，或粘贴表格内容；由千问直接匹配当前可领用研发物料。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div><div className="bom-content"><section className="bom-entry"><label htmlFor="bom-text">BOM 表或物料清单</label><div className="bom-import"><button className="btn small" type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}>{importing ? "正在读取…" : "选择 Excel 文件"}</button><small>支持 .xlsx、.xls、.csv，默认读取第一个工作表；也可从 Excel 复制单元格后粘贴。</small><input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt" onChange={importBomFile} hidden /></div><textarea id="bom-text" value={text} onChange={(event) => setText(event.target.value)} placeholder={"可直接从 Excel 复制粘贴，例如：\nESP32-S3-WROOM-1\t5\nMAX30102 血氧传感器\t2\n或每行填写一个物料名称"} autoFocus />{error && <div className="form-error">{error}</div>}<div className="bom-entry-foot"><small>只读取本次选择或粘贴的物料名称和数量，不会写入 BOM，也不会自动扣减物料。</small><button className="btn primary" onClick={match} disabled={matching || importing}>{matching ? "正在由 AI 匹配…" : "开始 AI 匹配"}</button></div></section>{rows.length > 0 && <section className="bom-results"><div className="bom-result-head"><div><h3>匹配结果</h3><p>{rows.length} 条物料中，{matchedCount} 条找到可参考的研发物料 · 由千问直接匹配</p></div></div><div className="bom-warning">文字相近不等于规格可替代。领用前请确认型号、封装、电压和关键参数。</div><div className="bom-result-list">{rows.map((row, index) => <div className="bom-row" key={`${row.name}-${index}`}><div className="bom-source"><strong>{row.name}</strong>{row.quantity ? <span>需求 {row.quantity} 个</span> : null}</div>{row.suggestions.length ? <div className="bom-suggestions">{row.suggestions.map((suggestion) => { const material = materials.find((item) => item.id === suggestion.materialId); return <div className="bom-suggestion" key={suggestion.materialId}><div><span className={`badge ${suggestion.level === "推荐" ? "green" : "amber"}`}>{suggestion.level}</span><strong>{suggestion.name}</strong><small>{suggestion.availableQuantity} 个可领用 · 发布人 {suggestion.publisherName}{suggestion.note ? ` · ${suggestion.note}` : ""}{suggestion.reason ? ` · ${suggestion.reason}` : ""}</small></div>{material && <button className="btn small primary" disabled={busy} onClick={() => onRequest(material)}>申请领用</button>}</div>; })}</div> : <div className="bom-empty">AI 未找到有足够依据的候选项</div>}</div>)}</div></section>}</div></div></div>;
}

function MaterialModal({ mode, material, busy, onClose, onSubmit }: { mode: "material" | "materialRequest" | "materialEdit"; material: Material | null; busy: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isRequest = mode === "materialRequest";
  const isMaterialEdit = mode === "materialEdit";
  const requestableQuantity = Math.max(0, Number(material?.availableQuantity ?? 0) - Number(material?.reservedQuantity ?? 0));
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="modal" onSubmit={onSubmit}><div className="modal-head"><div><h2>{isRequest ? "申请领用" : isMaterialEdit ? "编辑物料" : "发布物料"}</h2><p>{isRequest ? `向 ${material?.publisherName ?? "发布人"} 申请 ${material?.name ?? "物料"}` : isMaterialEdit ? material?.name ?? "物料" : "填写名称、数量和预估单价后即可发布。"}</p></div><button type="button" className="close" onClick={onClose} aria-label="关闭">×</button></div><div className="form">{isRequest ? <><div className="field"><label>物料</label><input value={material?.name ?? ""} readOnly /></div><div className="field"><label>申请数量 *</label><input name="quantity" type="number" min="1" max={requestableQuantity || 1} defaultValue="1" required /></div><small className="text-muted">当前可申请 {requestableQuantity} 个，待确认申请已自动预留数量。</small><div className="field"><label>用途说明（可选）</label><textarea name="note" placeholder="例如：用于功能样机验证" /></div></> : isMaterialEdit ? <><div className="field"><label>可领用数量 *</label><input name="quantity" type="number" min="0" max="10000" step="1" defaultValue={material?.availableQuantity ?? 0} required autoFocus /></div>{Number(material?.reservedQuantity ?? 0) > 0 && <small className="text-muted">其中 {material?.reservedQuantity} 个已被待确认申请预留，不能下调到更低数量。</small>}<div className="field"><label>预估单价（元/个）*</label><input name="estimatedUnitPrice" type="number" min="0.01" max="1000000" step="0.01" defaultValue={material?.estimatedUnitPrice ?? ""} required /></div></> : <><div className="field"><label>物料名称或型号 *</label><input name="name" placeholder="例如 ESP32-S3-WROOM-1" required autoFocus /></div><div className="form-row"><div className="field"><label>数量 *</label><input name="quantity" type="number" min="1" step="1" placeholder="例如 5" required /></div><div className="field"><label>预估单价（元/个）*</label><input name="estimatedUnitPrice" type="number" min="0.01" max="1000000" step="0.01" placeholder="例如 18.50" required /></div></div><div className="field"><label>分类</label><select name="category" defaultValue="模块"><option>模块</option><option>芯片</option><option>传感器</option><option>PCB</option><option>线材</option><option>其他</option></select></div><div className="field"><label>备注（可选）</label><textarea name="note" placeholder="例如：样机剩余，已验证可用" /></div></>}</div><div className="modal-actions"><button className="btn" type="button" onClick={onClose}>取消</button><button className="btn primary" disabled={busy || (isRequest && requestableQuantity < 1)} type="submit">{busy ? "正在处理…" : isRequest ? "提交申请" : isMaterialEdit ? "保存修改" : "发布物料"}</button></div></form></div>;
}

function Members({ users, products, currentEmail, busy, onAdd, onEdit, onDelete }: { users: Member[]; products: Product[]; currentEmail: string; busy: boolean; onAdd: () => void; onEdit: (member: Member) => void; onDelete: (member: Member) => void }) {
  const [scopeMember, setScopeMember] = useState<Member | null>(null);
  const scopeIds = new Set((scopeMember?.productIds ?? "").split(",").filter(Boolean));
  const scopeProducts = scopeMember?.role === "admin" ? products : products.filter((product) => scopeIds.has(product.id));
  function scopeLabel(member: Member) {
    if (member.role === "admin") return "全部产品";
    const assigned = (member.productIds ?? "").split(",").filter(Boolean);
    if (!assigned.length) return products.length ? "未分配" : "暂无产品";
    return `已分配 ${assigned.length} 个产品`;
  }
  return <><div className="page-head"><div><div className="eyebrow">Access Control</div><h1>成员与产品权限</h1><p>管理成员账号、岗位角色和可访问的产品范围。</p></div><div className="actions"><span className="badge green">{users.filter((user) => user.status === "active").length} 名启用成员</span><button className="btn primary" onClick={onAdd}>＋ 添加成员</button></div></div>
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>成员</th><th>状态</th><th>角色</th><th>产品范围</th><th>最近登录</th><th></th></tr></thead><tbody>{users.map((user) => <tr key={user.email}><td><div className="cell-main">{user.displayName}</div><div className="cell-sub">{user.email}</div>{user.mustChangePassword ? <span className="badge amber">等待首次改密</span> : null}</td><td><span className={`badge ${user.status === "active" ? "green" : "red"}`}><span className="dot" />{user.status === "active" ? "启用" : "停用"}</span></td><td><span className="badge">{roleLabel(user.role)}</span></td><td><button className={`scope-link ${user.role === "admin" ? "all" : ""}`} onClick={() => setScopeMember(user)}>{scopeLabel(user)}<span>›</span></button></td><td className="text-muted member-last-login">{formatShortDateTime(user.lastLoginAt)}</td><td><div className="actions"><button className="btn small" onClick={() => onEdit(user)}>编辑</button>{user.email.toLowerCase() !== currentEmail.toLowerCase() && <button className="btn small danger" disabled={busy} onClick={() => onDelete(user)}>删除</button>}</div></td></tr>)}</tbody></table></div></section>
    {scopeMember && <div className="modal-backdrop" role="presentation"><section className="modal scope-modal" role="dialog" aria-modal="true" aria-label="产品范围"><div className="modal-head"><div><h2>产品范围</h2><p>{scopeMember.displayName} · {scopeMember.role === "admin" ? "管理员拥有全部产品访问权限" : `已分配 ${scopeProducts.length} 个产品`}</p></div><button className="icon-button" onClick={() => setScopeMember(null)} aria-label="关闭">×</button></div><div className="modal-body"><div className="scope-product-list">{scopeProducts.length ? scopeProducts.map((product) => <div className="scope-product" key={product.id}><strong>{product.name}</strong><small>{product.code}</small></div>) : <div className="empty compact">暂未分配产品</div>}</div></div><div className="modal-actions"><button className="btn" onClick={() => setScopeMember(null)}>关闭</button><button className="btn primary" onClick={() => { const member = scopeMember; if (!member) return; setScopeMember(null); onEdit(member); }}>调整范围</button></div></section></div>}
  </>;
}

function VersionPackageRequirements({ productId, assetTypes, selectedKinds }: { productId: string; assetTypes: AssetType[]; selectedKinds: Set<string> }) {
  const labels: Record<string, string> = { "OTA-APP": "APP OTA 包", "OTA-Bootloader": "Bootloader OTA 包", "完整OTA包": "整包 OTA", "差分OTA包": "差分 OTA", "线刷包": "线刷包", "配置文件": "配置文件" };
  const kinds = ["OTA-APP", "OTA-Bootloader", "完整OTA包", "差分OTA包", "线刷包", "配置文件"].filter((kind) => assetTypes.some((item) => item.productId === productId && item.assetType === kind));
  return <div className="field"><label>本版本必需文件 *</label>{kinds.length ? <div className="check-grid">{kinds.map((kind) => <label className="check-card" key={kind}><input type="checkbox" name="expectedKinds" value={kind} defaultChecked={selectedKinds.has(kind)} /><span>{labels[kind]}</span></label>)}</div> : <div className="form-note">该产品尚未启用固件资料类型，请先在产品资料类型中勾选对应的包类型。</div>}<small>只勾选本次版本实际应包含的文件；提交测试时会检查是否已上传齐全。</small></div>;
}

function ActionModal({ mode, products, productFiles, releases, protocols, users, ownerCandidates, currentUser, selectedMember, selectedRelease, targetReleaseId, selectedProtocol, selectedTool, selectedProduct, selectedProductId, allHardwareVariants, allAssetTypes, selectedHardwareVariants, selectedAssetTypes, sourceArtifact, uploadKind, productFileCategory, uploadMaxMb, busy, onCreateVersion, onClose, onSubmit }: { mode: "upload" | "replace" | "product" | "editProduct" | "productFile" | "protocol" | "protocolRecord" | "editProtocol" | "release" | "version" | "editVersion" | "tool" | "editTool" | "toolFile" | "member"; products: Product[]; productFiles: ProductFile[]; releases: Release[]; protocols: Protocol[]; users: Member[]; ownerCandidates: OwnerCandidate[]; currentUser: CurrentUser; selectedMember: Member | null; selectedRelease: Release | null; targetReleaseId: string | null; selectedProtocol: Protocol | null; selectedTool: Tool | null; selectedProduct: Product | null; selectedProductId: string | null; allHardwareVariants: HardwareVariant[]; allAssetTypes: AssetType[]; selectedHardwareVariants: HardwareVariant[]; selectedAssetTypes: AssetType[]; sourceArtifact?: Artifact; uploadKind?: string; productFileCategory: ProductFile["category"]; uploadMaxMb: number; busy: boolean; onCreateVersion: () => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [productStep, setProductStep] = useState(1);
  const [hardwareRows, setHardwareRows] = useState(selectedHardwareVariants.length ? selectedHardwareVariants.map((item) => item.id) : ["hw-1"]);
  const [uploadProductId, setUploadProductId] = useState(sourceArtifact?.productId ?? selectedProductId ?? products[0]?.id ?? "");
  const [uploadReleaseId, setUploadReleaseId] = useState(sourceArtifact?.releaseId ?? targetReleaseId ?? releases.find((release) => release.productId === (selectedProductId ?? products[0]?.id) && ["草稿", "开发自测"].includes(release.status))?.id ?? "");
  const [versionProductId, setVersionProductId] = useState(selectedRelease?.productId ?? selectedProductId ?? products[0]?.id ?? "");
  const assignedProducts = new Set((selectedMember?.productIds ?? "").split(",").filter(Boolean));
  const selectedToolProducts = new Set((selectedTool?.productIds ?? "").split(",").filter(Boolean));
  const assignedMembers = new Set(users.filter((user) => (user.productIds ?? "").split(",").includes(selectedProduct?.id ?? "")).map((user) => user.email));
  const currentAssetTypes = new Set(selectedAssetTypes.map((item) => item.assetType));
  const documentFileCount = productFiles.filter((item) => item.productId === selectedProductId && item.category === productFileCategory).length;
  const suggestedDocumentVersion = `V${documentFileCount + 1}.0`;
  const productMode = mode === "product" || mode === "editProduct";
  const productSteps = currentUser.isAdmin ? ["基本信息", "硬件版本", "资料类型", "成员授权"] : ["基本信息", "硬件版本", "资料类型"];
  const uploadMode = ["upload", "replace", "productFile", "protocol", "toolFile"].includes(mode);
  const assetOptions = ["产品立项书", "产品需求文档", "电路文件", "OTA-APP", "OTA-Bootloader", "完整OTA包", "差分OTA包", "线刷包", "配置文件", "通信协议", "烧录工具", "调试工具"];
  const mandatoryAssetTypes = ["产品立项书", "产品需求文档"];
  const assetLabels: Record<string, string> = { "OTA-APP": "APP OTA 包（仅升级 APP）", "OTA-Bootloader": "Bootloader OTA 包（仅升级 Bootloader）", "完整OTA包": "整包 OTA（APP 与 Bootloader 一起升级）", "差分OTA包": "差分 OTA（从指定旧版本增量升级）", "电路文件": "电路文件（原理图 / PCB / BOM）" };
  const config: Record<typeof mode, [string, string, string]> = {
    upload: [sourceArtifact ? "替换草稿文件" : "上传版本文件", sourceArtifact ? `将替换 ${sourceArtifact.name}，此版本尚未提交测试。` : "", sourceArtifact ? "替换并校验" : "上传并校验"], productFile: ["上传产品资料", "请选择立项书、需求文档或电路文件。", "上传并校验"],
    replace: ["申请替换固件文件", "新文件将在管理员批准后生效，原修订版不会被删除。", "提交替换申请"],
    product: ["创建产品", "一次建立产品、硬件版本、资料范围和成员授权。", "创建产品"],
    editProduct: ["编辑产品", "修改产品信息、硬件版本、资料范围和成员授权。", "保存修改"],
    protocol: ["上传协议附件", "支持协议文档、DBC、JSON Schema、Proto 和寄存器表。", "上传并校验"],
    protocolRecord: ["新建协议", "建立协议版本和接口信息，随后可以上传附件。", "创建协议"],
    editProtocol: ["编辑协议", "修改协议名称、版本、接口和发布状态。", "保存修改"],
    release: ["提交固件测试", "", "提交测试"],
    version: ["新建固件版本", "先建立版本和构建信息，再上传对应的固件文件。", "创建版本"],
    editVersion: ["编辑固件版本", "修正版本号、构建号、通道和关联版本信息。", "保存修改"],
    tool: ["新建独立工具", "工具先独立保存，可同时关联多个产品，也可以暂不关联。", "创建工具"],
    editTool: ["编辑工具与关联", "修改工具资料，并手动关联或取消关联产品。", "保存修改"],
    toolFile: ["上传工具文件", `为 ${selectedTool?.name ?? "工具"} 上传安装包、驱动或配置模板。`, "上传并校验"],
    member: [selectedMember ? "编辑成员" : "添加成员", "设置业务角色、账号状态和可访问的产品范围。", "保存成员"],
  };
  const currentConfig = config[mode];
  const uploadReleases = releases.filter((release) => release.productId === uploadProductId && (mode === "replace" || ["草稿", "开发自测"].includes(release.status)));
  const uploadTargetUnavailable = Boolean(uploadReleaseId) && !uploadReleases.some((release) => release.id === uploadReleaseId);
  const effectiveUploadReleaseId = uploadTargetUnavailable ? "" : uploadReleaseId;
  const clearUploadFile = () => { const input = formRef.current?.querySelector<HTMLInputElement>('input[name="file"]'); if (input) input.value = ""; };
  const releasableReleases = releases.filter((release) => release.status === "开发自测");
  const versionHardware = allHardwareVariants.filter((item) => item.productId === versionProductId);
  const versionProtocols = protocols.filter((item) => item.productId === versionProductId);
  const firmwareKindOptions = ["OTA-APP", "OTA-Bootloader", "完整OTA包", "差分OTA包", "线刷包", "配置文件"];
  const versionAssetTypes = new Set(allAssetTypes.filter((item) => item.productId === versionProductId).map((item) => item.assetType));
  const selectedReleaseExpectedKinds = new Set((selectedRelease?.expectedKinds ?? "").split(",").filter(Boolean));
  const defaultExpectedKinds = selectedReleaseExpectedKinds.size ? selectedReleaseExpectedKinds : new Set(firmwareKindOptions.filter((kind) => versionAssetTypes.has(kind)));
  const protocolUploadProductId = selectedProtocol?.productId ?? selectedProductId ?? "";
  const availableProtocols = protocols.filter((item) => item.productId === protocolUploadProductId);
  const selectedReleaseHardware = new Set((selectedRelease?.hardwareVariantIds ?? "").split(",").filter(Boolean));
  const selectedReleaseProtocols = new Set((selectedRelease?.protocolIds ?? "").split(",").filter(Boolean));
  const addHardware = () => setHardwareRows((rows) => [...rows, `hw-${crypto.randomUUID()}`]);
  const removeHardware = (id: string) => setHardwareRows((rows) => rows.length === 1 ? rows : rows.filter((row) => row !== id));
  const advanceProductStep = () => {
    const activePanel = formRef.current?.querySelector(".wizard-panel:not(.hidden)");
    const requiredFields = Array.from(activePanel?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[required], select[required], textarea[required]") ?? []);
    const invalidField = requiredFields.find((field) => !field.checkValidity());
    if (invalidField) {
      invalidField.reportValidity();
      invalidField.focus();
      return;
    }
    setProductStep((step) => Math.min(step + 1, productSteps.length));
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (busy || ((mode === "upload" || mode === "replace") && (!effectiveUploadReleaseId || uploadTargetUnavailable))) { event.preventDefault(); return; }
    // Navigation and implicit form submission must never save a partial product.
    if (productMode && (productStep !== productSteps.length || (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") !== "saveProduct")) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className={`modal ${productMode ? "modal-wide" : ""}`}><div className="modal-head"><h2>{currentConfig[0]}</h2><button type="button" className="close" onClick={onClose} aria-label="关闭">×</button></div><form ref={formRef} noValidate={productMode && productStep === productSteps.length} onSubmit={handleSubmit}>
    {productMode && <div className="wizard-steps">{productSteps.map((label, index) => <div key={label} className={`wizard-step ${productStep === index + 1 ? "active" : productStep > index + 1 ? "done" : ""}`}><span>{productStep > index + 1 ? "✓" : index + 1}</span>{label}</div>)}</div>}
    <div className="form">
      {uploadMode && <div className="form-note">单文件上限 {uploadMaxMb} MB。超过 50 MB 会在提交前提醒；上传与校验期间请勿关闭页面。</div>}
      {(mode === "version" || mode === "editVersion") && <VersionPackageRequirements productId={versionProductId} assetTypes={allAssetTypes} selectedKinds={defaultExpectedKinds} />}
      {productMode && <>
        <div className={productStep === 1 ? "wizard-panel" : "wizard-panel hidden"}>
          <div className="form-row">
            <div className="field"><label>产品型号 *</label><input name="code" defaultValue={selectedProduct?.code ?? ""} placeholder="例如 EC-A100" required={productStep === 1} /></div>
            <div className="field"><label>产品名称 *</label><input name="name" defaultValue={selectedProduct?.name ?? ""} placeholder="例如 边缘控制器 A100" required={productStep === 1} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>产品系列</label><input name="family" defaultValue={selectedProduct?.family ?? ""} placeholder="例如 工业控制" /></div>
            <div className="field">
              <label>产品负责人</label>
              {mode === "product" ? <><select name="ownerEmail" defaultValue={currentUser.email}><option value={currentUser.email}>{currentUser.displayName}（当前创建者）</option>{ownerCandidates.filter((user) => user.email.toLowerCase() !== currentUser.email.toLowerCase()).map((user) => <option value={user.email} key={user.email}>{user.displayName}</option>)}</select><small>可指定一名启用成员为负责人；创建者会保留该产品的协作权限。</small></> : <><input value={selectedProduct?.owner ?? "未绑定负责人"} readOnly />{currentUser.isAdmin && <select name="ownerEmail" defaultValue=""><option value="">保持当前负责人</option>{users.filter((user) => user.status === "active").map((user) => <option value={user.email} key={user.email}>改为 {user.displayName}</option>)}</select>}<small>{currentUser.isAdmin ? "如需变更，请选择新的负责人；保存后会自动授予其创建产品权限。" : "只有管理员可以变更负责人。"}</small></>}
            </div>
          </div>
          <div className="form-row"><div className="field"><label>阶段</label><select name="status" defaultValue={selectedProduct?.status ?? "研发"}><option>研发</option><option>试产</option><option>量产</option><option>停产</option></select></div></div>
          <div className="field"><label>产品说明</label><textarea name="description" defaultValue={selectedProduct?.description ?? ""} placeholder="说明产品用途、芯片平台和典型部署环境" /></div>
        </div>
        <div className={productStep === 2 ? "wizard-panel" : "wizard-panel hidden"}><div className="section-intro"><strong>至少添加一个硬件版本</strong><span>用于约束固件兼容范围，后续仍可继续扩展。</span></div>{hardwareRows.map((id, index) => { const variant = selectedHardwareVariants.find((item) => item.id === id); return <div className="hardware-editor" key={id}><input type="hidden" name="hwId" value={variant?.id ?? ""} /><div className="hardware-editor-head"><strong>硬件版本 {index + 1}</strong>{hardwareRows.length > 1 && <button type="button" className="btn small danger" onClick={() => removeHardware(id)}>移除</button>}</div><div className="form-row"><div className="field"><label>版本代号 *</label><input name="hwCode" defaultValue={variant?.code ?? ""} placeholder="例如 HW-A" required /></div><div className="field"><label>MCU / SoC *</label><input name="mcu" defaultValue={variant?.mcu ?? ""} placeholder="例如 STM32H743" required /></div></div><div className="form-row"><div className="field"><label>Flash</label><input name="flashSize" defaultValue={variant?.flashSize ?? ""} placeholder="例如 2 MB" /></div><div className="field"><label>RAM</label><input name="ramSize" defaultValue={variant?.ramSize ?? ""} placeholder="例如 1 MB" /></div></div><div className="form-row"><div className="field"><label>PCB 版本</label><input name="pcbVersion" defaultValue={variant?.pcbVersion ?? ""} placeholder="例如 PCB V1.2" /></div><div className="field"><label>最低 Bootloader</label><input name="minBootloader" defaultValue={variant?.minBootloader ?? ""} placeholder="例如 v1.0.0" /></div></div><div className="field"><label>通信接口</label><input name="interfaces" defaultValue={variant?.interfaces ?? ""} placeholder="CAN-FD、RS485、以太网、BLE…" /></div></div>; })}<button type="button" className="btn" onClick={addHardware}>＋ 添加硬件版本</button></div>
        <div className={productStep === 3 ? "wizard-panel" : "wizard-panel hidden"}>
          <div className="section-intro"><strong>这个产品需要维护哪些资料？</strong><span>基础资料已锁定；其余资料按实际需要勾选，产品页会据此显示对应入口。</span></div>
          <div className="check-grid">{assetOptions.map((item) => {
            const requiredAsset = mandatoryAssetTypes.includes(item);
            const selected = requiredAsset || (mode === "editProduct" ? currentAssetTypes.has(item) : ["电路文件", "OTA-APP", "OTA-Bootloader", "线刷包", "通信协议", "烧录工具"].includes(item));
            return <label className={`check-card ${requiredAsset ? "required-asset" : ""}`} key={item}><input type="checkbox" name="assetTypes" value={item} defaultChecked={selected} disabled={requiredAsset} /><span>{assetLabels[item] ?? item}{requiredAsset && <small className="required-asset-tag">基础必填</small>}</span></label>;
          })}</div>
        </div>
        {currentUser.isAdmin && <div className={productStep === 4 ? "wizard-panel" : "wizard-panel hidden"}><div className="section-intro"><strong>分配成员</strong><span>管理员默认拥有全部产品权限；这里可选开发、测试、审核和只读成员。</span></div>{users.length ? <div className="check-list">{users.map((user) => <label className="check-card" key={user.email}><input type="checkbox" name="memberEmails" value={user.email} defaultChecked={mode === "editProduct" && assignedMembers.has(user.email)} /><span><strong>{user.displayName}</strong><small>{user.email} · {roleLabel(user.role)}</small></span></label>)}</div> : <div className="form-note">当前没有可分配成员，可以保存产品后再到“成员权限”中添加。</div>}</div>}
      </>}
      {(mode === "upload" || mode === "replace") && <>
        {uploadTargetUnavailable && <div className="form-error" role="alert">原目标版本已进入其他流程或不可用，上传已暂停。请确认后重新选择版本；重新选择会清空已选文件。</div>}
        <div className="form-row"><div className="field"><label>产品</label><select name="productId" value={uploadProductId} onChange={(event) => { setUploadProductId(event.target.value); setUploadReleaseId(""); clearUploadFile(); }} disabled={mode === "replace"} required>{products.map((p) => <option value={p.id} key={p.id}>{p.code} · {p.name}</option>)}</select></div><div className="field"><label>{mode === "replace" ? "固件版本" : "目标固件版本"}</label><select name="releaseId" value={effectiveUploadReleaseId} onChange={(event) => { setUploadReleaseId(event.target.value); clearUploadFile(); }} disabled={uploadReleases.length === 0} required><option value="" disabled>请选择目标固件版本</option>{uploadReleases.map((r) => <option value={r.id} key={r.id}>{r.version} · Build {r.buildNumber} · {r.status}</option>)}</select></div></div>
        {mode === "upload" && uploadReleases.length === 0 && <div className="version-required"><div><strong>请先创建新的固件版本</strong><span>已发布版本保持只读，新文件会归入新的版本包。</span></div><button type="button" className="btn primary" onClick={onCreateVersion}>＋ 新建固件版本</button></div>}
        {mode === "replace" ? <><input type="hidden" name="productId" value={uploadProductId} /><input type="hidden" name="sourceArtifactId" value={sourceArtifact?.id ?? ""} /><div className="form-row"><div className="field"><label>当前文件</label><input value={sourceArtifact?.name ?? "没有可替换的生效文件"} readOnly /></div><div className="field"><label>新修订号</label><input name="newRevision" defaultValue="R2" required /></div></div><div className="field"><label>替换原因</label><textarea name="reason" placeholder="说明问题现象、复现条件和修复内容" required /></div><div className="field"><label>影响范围</label><input name="impact" placeholder="例如：影响 HW-B，建议冻结原文件下载" required /></div></> : <><input type="hidden" name="replaceArtifactId" value={sourceArtifact?.id ?? ""} /><div className="form-row"><div className="field"><label>文件类型</label><select name="kind" defaultValue={uploadKind ?? sourceArtifact?.kind ?? "OTA-APP"}><option value="OTA-APP">APP OTA 包</option><option value="OTA-Bootloader">Bootloader OTA 包</option><option value="完整OTA包">整包 OTA</option><option value="差分OTA包">差分 OTA</option><option value="线刷包">线刷包</option><option value="配置文件">配置文件</option></select></div><div className="field"><label>文件修订</label><input name="revision" defaultValue={sourceArtifact ? sourceArtifact.revision : "R1"} required /></div></div><div className="field"><label>选择文件</label><input name="file" type="file" required /><small>单文件上限 {uploadMaxMb} MB。超过 50MB 会在提交前提醒；上传与校验期间请勿关闭页面。</small></div></>}
        {mode === "replace" && <div className="form-note">审批期间原文件保持生效；批准后新修订生效，旧修订仍保留在审计记录中。</div>}
      </>}
      {mode === "productFile" && <><div className="field"><label>所属产品</label><input value={selectedProduct ? `${selectedProduct.code} · ${selectedProduct.name}` : "未选择产品"} readOnly /></div><div className="field"><label>资料类型</label><input value={{ project_charter: "产品立项书", requirements: "产品需求文档", hardware_package: "电路文件（原理图 / PCB / BOM）" }[productFileCategory]} readOnly /><input type="hidden" name="category" value={productFileCategory} /></div>{productFileCategory !== "hardware_package" && <><div className="form-row"><div className="field"><label>文档版本 *</label><input name="version" defaultValue={suggestedDocumentVersion} placeholder="例如 V1.1" required /></div><div className="field"><label>变更说明</label><input name="changeNote" placeholder="例如：补充验收指标" /></div></div></>}<div className="field"><label>选择文件</label><input name="file" type="file" required /><small>{productFileCategory === "hardware_package" ? "上传后会成为当前电路文件。" : "新文件会成为当前版本，历史版本可在产品资料页查看和下载。"}</small></div></>}
      {(mode === "version" || mode === "editVersion") && <><div className="field"><label>产品</label><select name={mode === "editVersion" ? undefined : "productId"} value={versionProductId} onChange={(event) => setVersionProductId(event.target.value)} disabled={mode === "editVersion"} required>{products.map((p) => <option value={p.id} key={p.id}>{p.code} · {p.name}</option>)}</select>{mode === "editVersion" && <input type="hidden" name="productId" value={versionProductId} />}</div><div className="form-row"><div className="field"><label>固件版本 *</label><input name="version" defaultValue={selectedRelease?.version ?? ""} placeholder="例如 v1.0.0" required /></div><div className="field"><label>构建号 *</label><input name="buildNumber" defaultValue={selectedRelease?.buildNumber ?? ""} placeholder="例如 20260814.1" required /></div></div><div className="form-row"><div className="field"><label>发布通道</label><select name="channel" defaultValue={selectedRelease?.channel ?? "Dev"}><option>Dev</option><option>Beta</option><option>RC</option><option>Stable</option></select></div><div className="field"><label>最低升级版本</label><input name="minUpgradeVersion" defaultValue={selectedRelease?.minUpgradeVersion ?? ""} placeholder="例如 v0.9.0，留空表示无限制" /></div></div><div className="form-row"><div className="field"><label>Bootloader 版本</label><input name="bootloaderVersion" defaultValue={selectedRelease?.bootloaderVersion ?? ""} placeholder="例如 v1.0.0" /></div><div className="field"><label>APP 版本</label><input name="appVersion" defaultValue={selectedRelease?.appVersion ?? ""} placeholder="例如 v1.0.0" /></div></div><div className="field"><label>支持的硬件版本 *</label><div className="check-grid">{versionHardware.map((item) => <label className="check-card" key={item.id}><input type="checkbox" name="hardwareVariantIds" value={item.id} defaultChecked={mode === "editVersion" ? selectedReleaseHardware.has(item.id) : true} /><span><strong>{item.code}</strong><small>{item.mcu} · {item.pcbVersion}</small></span></label>)}</div>{versionHardware.length === 0 && <div className="form-note">该产品没有硬件版本，请先编辑产品并添加硬件。</div>}</div><div className="field"><label>绑定通信协议</label><div className="check-grid">{versionProtocols.map((item) => <label className="check-card" key={item.id}><input type="checkbox" name="protocolIds" value={item.id} defaultChecked={selectedReleaseProtocols.has(item.id)} /><span>{item.name} · {item.version}</span></label>)}</div>{versionProtocols.length === 0 && <div className="text-muted">该产品暂时没有协议，可以稍后补充。</div>}</div><div className="field"><label>协议摘要</label><input name="protocolSummary" defaultValue={selectedRelease?.protocolSummary ?? ""} placeholder="用于列表快速识别，例如 CAN v2.1" /></div><div className="field"><label>版本更新说明 *</label><textarea name="releaseNotes" defaultValue={selectedRelease?.releaseNotes ?? ""} placeholder="列出新增功能、修复内容和影响范围" required /></div><div className="field"><label>已知问题</label><textarea name="knownIssues" defaultValue={selectedRelease?.knownIssues ?? ""} placeholder="没有可填写“无”" /></div><label className="check-card"><input type="checkbox" name="allowDowngrade" defaultChecked={Boolean(selectedRelease?.allowDowngrade)} /><span><strong>允许降级</strong><small>默认禁止；仅在兼容性验证通过时启用。</small></span></label></>}
      {mode === "member" && <><div className="form-row"><div className="field"><label>姓名 *</label><input name="displayName" defaultValue={selectedMember?.displayName ?? ""} required /></div><div className="field"><label>邮箱 *</label><input type="email" name="email" defaultValue={selectedMember?.email ?? ""} readOnly={Boolean(selectedMember)} required /></div></div><div className="form-row"><div className="field"><label>角色</label><select name="role" defaultValue={selectedMember?.role ?? "viewer"}><option value="viewer">只读用户</option><option value="developer">开发人员</option><option value="tester">测试工程师</option><option value="product_owner">产品负责人</option><option value="project_manager">项目经理</option><option value="admin">管理员</option></select></div><div className="field"><label>账号状态</label><select name="status" defaultValue={selectedMember?.status ?? "active"}><option value="active">启用</option><option value="disabled">停用</option></select></div></div><label className="check-card"><input type="checkbox" name="canCreateProducts" defaultChecked={Boolean(selectedMember?.canCreateProducts)} /><span><strong>允许创建产品</strong></span></label><div className="field"><label>{selectedMember ? "重置临时密码" : "临时密码 *"}</label><input name="temporaryPassword" type="password" autoComplete="new-password" minLength={10} required={!selectedMember} placeholder={selectedMember ? "留空表示不修改密码" : "至少 10 个字符"} /></div><div className="field"><label>协作产品</label><div className="check-grid">{products.map((product) => <label className="check-card" key={product.id}><input type="checkbox" name="productIds" value={product.id} defaultChecked={assignedProducts.has(product.id)} /><span>{product.code} · {product.name}</span></label>)}</div><small>所有用户均可浏览产品目录；勾选后才可参与该产品的开发、测试等工作。</small>{products.length === 0 && <div className="text-muted">暂无产品</div>}</div></>}
      {(mode === "protocolRecord" || mode === "editProtocol") && <><div className="field"><label>所属产品</label><select name="productId" defaultValue={selectedProtocol?.productId ?? selectedProductId ?? products[0]?.id} disabled={mode === "editProtocol"} required>{products.map((p) => <option value={p.id} key={p.id}>{p.code} · {p.name}</option>)}</select>{mode === "editProtocol" && <input type="hidden" name="productId" value={selectedProtocol?.productId ?? ""} />}</div><div className="form-row"><div className="field"><label>协议名称 *</label><input name="name" defaultValue={selectedProtocol?.name ?? ""} placeholder="例如 CAN 应用层协议" required /></div><div className="field"><label>协议版本 *</label><input name="version" defaultValue={selectedProtocol?.version ?? ""} placeholder="例如 v1.0" required /></div></div><div className="form-row"><div className="field"><label>接口类型</label><input name="interfaceType" defaultValue={selectedProtocol?.interfaceType ?? ""} placeholder="CAN-FD、RS485、UART…" /></div><div className="field"><label>状态</label><select name="status" defaultValue={selectedProtocol?.status ?? "草稿"}><option>草稿</option><option>评审中</option><option>已发布</option><option>已废止</option></select></div></div><div className="field"><label>协议说明</label><textarea name="description" defaultValue={selectedProtocol?.description ?? ""} placeholder="说明帧格式、适用硬件和兼容性" /></div></>}
      {mode === "protocol" && <>{availableProtocols.length ? <><input type="hidden" name="productId" value={protocolUploadProductId} /><div className="field"><label>选择通信协议 *</label><select name="protocolId" defaultValue={selectedProtocol?.id ?? availableProtocols[0]?.id} required>{availableProtocols.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.version} · {item.interfaceType}</option>)}</select></div><div className="field"><label>上传协议文件 *</label><input name="file" type="file" accept=".pdf,.doc,.docx,.xlsx,.dbc,.json,.proto,.md,.txt" required /></div><div className="form-note">文件会关联到当前产品和所选协议版本。</div></> : <div className="form-note">当前产品还没有协议记录，请先创建协议，再上传协议文件。</div>}</>}
      {(mode === "tool" || mode === "editTool") && <><div className="form-row"><div className="field"><label>工具名称 *</label><input name="name" defaultValue={selectedTool?.name ?? ""} placeholder="例如 STM32CubeProgrammer" required /></div><div className="field"><label>版本 *</label><input name="version" defaultValue={selectedTool?.version ?? ""} placeholder="例如 v2.18.0" required /></div></div><div className="form-row"><div className="field"><label>平台</label><input name="platform" defaultValue={selectedTool?.platform ?? ""} placeholder="Windows / Linux / 跨平台" /></div><div className="field"><label>状态</label><select name="status" defaultValue={selectedTool?.status ?? "维护中"}><option>维护中</option><option>推荐</option><option>已停用</option></select></div></div><div className="field"><label>工具说明</label><textarea name="description" defaultValue={selectedTool?.description ?? ""} placeholder="说明用途、支持芯片和使用注意事项" /></div><div className="field"><label>手动关联产品（可多选）</label><div className="check-grid">{products.map((product) => <label className="check-card" key={product.id}><input type="checkbox" name="productIds" value={product.id} defaultChecked={selectedToolProducts.has(product.id)} /><span><strong>{product.name}</strong><small>{product.code}</small></span></label>)}</div>{products.length === 0 && <div className="text-muted">暂无可关联产品；工具仍可独立保存和上传文件。</div>}<small>取消勾选只会解除关联，不会删除工具或已经上传的文件。</small></div></>}
      {mode === "toolFile" && <><div className="field"><label>工具</label><input value={selectedTool ? `${selectedTool.name} · ${selectedTool.version}` : "未选择工具"} readOnly /></div><div className="field"><label>安装包或附件</label><input name="file" type="file" required /></div></>}
      {mode === "release" && <><div className="field"><label>待测试版本</label><select name="releaseId" defaultValue={selectedRelease?.id ?? releasableReleases[0]?.id} required>{releasableReleases.map((r) => <option value={r.id} key={r.id}>{r.version} · Build {r.buildNumber}</option>)}</select></div><div className="form-row"><div className="field"><label>优先级</label><select name="priority" defaultValue="普通"><option>紧急</option><option>高</option><option>普通</option><option>低</option></select></div><div className="field"><label>期望完成时间</label><input name="expectedAt" type="datetime-local" /></div></div><div className="field"><label>测试说明</label><textarea name="summary" defaultValue={selectedRelease?.releaseNotes ?? ""} placeholder="主要变更和测试重点" required /></div><div className="field"><label>开发自测结果</label><textarea name="verification" placeholder="已完成的验证和已知风险" required /></div></>}
    </div>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>取消</button>{productMode && productStep > 1 && <button type="button" className="btn" onClick={() => setProductStep((step) => step - 1)}>上一步</button>}{productMode && productStep < productSteps.length ? <button key="product-next" type="button" className="btn primary" onClick={(event) => { event.preventDefault(); advanceProductStep(); }}>下一步</button> : <button key="modal-submit" name={productMode ? "saveProduct" : undefined} disabled={busy || ((mode === "upload" || mode === "replace") && !effectiveUploadReleaseId) || (mode === "protocol" && availableProtocols.length === 0) || (mode === "upload" && uploadReleases.length === 0) || (mode === "release" && releasableReleases.length === 0) || ((mode === "version" || mode === "editVersion") && versionHardware.length === 0)} type="submit" className="btn primary">{busy ? (uploadMode ? "正在上传与校验，请勿关闭页面…" : "正在处理…") : currentConfig[2]}</button>}</div>
  </form></div></div>;
}
