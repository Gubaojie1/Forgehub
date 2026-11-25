"use client";

import { FormEvent, useEffect, useState } from "react";
import { authFetch } from "@/lib/client-auth";

type LcscModel = {
  id: string;
  title: string;
  lcscPart: string;
  manufacturerPart: string;
  packageName: string;
  imageUrl: string;
  modelUuid: string;
};

export function Lcsc3DDownloader() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LcscModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searched, setSearched] = useState(false);
  const [extensionReady, setExtensionReady] = useState(false);
  const [extensionChecked, setExtensionChecked] = useState(false);
  const [saveFolder, setSaveFolder] = useState("");
  const [choosingFolder, setChoosingFolder] = useState(false);

  useEffect(() => {
    let active = true;
    const requestId = crypto.randomUUID();
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source !== "forgehub-lcsc-extension" || message.requestId !== requestId) return;
      if (message.action === "ping-result" && active) {
        setExtensionReady(Boolean(message.ok));
        if (typeof message.folderPath === "string") setSaveFolder(message.folderPath);
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "forgehub-lcsc-web", action: "ping", requestId }, window.location.origin);
    const timer = window.setTimeout(() => { if (active) setExtensionChecked(true); }, 1500);
    return () => { active = false; window.clearTimeout(timer); window.removeEventListener("message", onMessage); };
  }, []);

  function requestNativeAction(action: "download" | "choose-folder", model?: LcscModel) {
    return new Promise<{ ok: boolean; error?: string; fileName?: string; folderPath?: string; cancelled?: boolean }>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("下载助手没有响应，请确认扩展已启用并刷新网页"));
      }, 150_000);
      const onMessage = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const message = event.data;
        if (message?.source !== "forgehub-lcsc-extension" || message.requestId !== requestId || message.action !== `${action}-result`) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(message);
      };
      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "forgehub-lcsc-web",
        action,
        requestId,
        ...(model ? {
          modelUuid: model.modelUuid,
          fileName: model.manufacturerPart || model.lcscPart || model.title || model.id,
        } : {}),
      }, window.location.origin);
    });
  }

  async function chooseFolder() {
    setChoosingFolder(true); setError("");
    try {
      const result = await requestNativeAction("choose-folder");
      if (result.folderPath) setSaveFolder(result.folderPath);
      if (result.cancelled) return;
      if (!result.ok) throw new Error(result.error ?? "无法更改保存目录");
      setSuccess(`STEP 文件将保存到：${result.folderPath}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法更改保存目录"); }
    finally { setChoosingFolder(false); }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) { setError("请输入立创编号、型号或关键词"); return; }
    setLoading(true); setError(""); setSuccess(""); setSearched(true); setResults([]);
    try {
      const response = await authFetch(`/api/lcsc/3d/search?q=${encodeURIComponent(value)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "搜索失败");
      setResults(body.results ?? []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "搜索失败，请稍后重试"); }
    finally { setLoading(false); }
  }

  async function download(model: LcscModel) {
    if (!extensionReady) {
      setError("请先安装 ForgeHub 下载扩展，并刷新本页面；安装步骤见上方说明。");
      return;
    }
    setDownloading(model.id); setError(""); setSuccess("");
    try {
      const result = await requestNativeAction("download", model);
      if (!result.ok) throw new Error(result.error ?? "STEP 下载失败");
      setSuccess(`${result.fileName || "STEP 文件"} 已保存到 ${result.folderPath || saveFolder || "Windows“下载”目录"}。`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "STEP 下载失败"); }
    finally { setDownloading(null); }
  }

  return <div className="page">
    <div className="page-head"><div><h1>立创商城 3D 元件下载</h1><p>搜索立创商城元件，找到关联的 3D 模型后下载 STEP 文件。</p></div></div>
    <section className="panel lcsc3d-helper">
      <div className="lcsc3d-helper-status"><div><strong>本机下载助手</strong><p>由你电脑上的扩展直接获取 STEP；默认保存在“下载”目录，可按需更改。</p></div><span className={`badge ${extensionReady ? "success" : ""}`}>{extensionReady ? "已连接" : extensionChecked ? "未安装或未连接" : "检测中…"}</span></div>
      {extensionReady && <div className="lcsc3d-folder-row"><span className="lcsc3d-folder-path" title={saveFolder}>保存位置：{saveFolder || "正在读取…"}</span><button className="btn small" type="button" onClick={() => void chooseFolder()} disabled={choosingFolder}>{choosingFolder ? "请选择文件夹…" : "选择目录"}</button></div>}
      {!extensionReady && <div className="lcsc3d-install"><a className="btn primary small" href="/downloads/forgehub-lcsc-extension.zip" download>下载扩展与本地助手</a><details open><summary>首次安装步骤</summary><ol><li>下载 ZIP 并解压到一个固定文件夹。</li><li>打开 Edge 的 <code>edge://extensions</code> 或 Chrome 的 <code>chrome://extensions</code>。</li><li>开启“开发人员模式”，点击“加载解压缩的扩展”，选择解压后的 <code>lcsc-browser-extension</code> 文件夹。</li><li>双击解压目录里的 <code>Install-ForgeHub-Helper.cmd</code> 完成本地助手安装。</li><li>回到 ForgeHub，刷新本页面；状态显示“已连接”后即可下载。</li></ol></details></div>}
    </section>
    <section className="panel lcsc3d-search-panel">
      <div className="panel-head"><div><div className="panel-title">搜索元件</div><div className="panel-sub">支持立创 C 编号、器件型号或关键词</div></div></div>
      <div className="panel-body">
        <form className="lcsc3d-search" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：C25744、ESP32-S3、USB Type-C" aria-label="立创元件编号或关键词" maxLength={100} /><button className="btn primary" type="submit" disabled={loading}>{loading ? "搜索中…" : "搜索元件"}</button></form>
        <div className="lcsc3d-notice">STEP 文件由本机助手获取并保存到你的本机目录（默认是“下载”），不经过 ForgeHub 服务器。</div>
      </div>
    </section>
    {error && <div className="form-note lcsc3d-error" role="alert">{error}</div>}
    {success && <div className="lcsc3d-success" role="status">{success}</div>}
    {results.length > 0 && <section className="panel"><div className="panel-head"><div><div className="panel-title">搜索结果</div><div className="panel-sub">找到 {results.length} 个元件；没有 STEP 下载按钮的结果暂未关联可用 3D 模型</div></div></div><div className="lcsc3d-results">{results.map((item) => <article className="lcsc3d-result" key={item.id}><div className="lcsc3d-image">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span>3D</span>}</div><div className="lcsc3d-info"><strong>{item.title || "未命名元件"}</strong><div className="lcsc3d-meta"><span>立创编号：{item.lcscPart || "—"}</span><span>厂商型号：{item.manufacturerPart || "—"}</span><span>封装：{item.packageName || "—"}</span></div></div><div className="lcsc3d-result-action">{item.modelUuid ? <button className="btn small primary" disabled={downloading !== null} onClick={() => void download(item)}>{downloading === item.id ? "下载中…" : "下载 STEP"}</button> : <span className="badge">无 3D 模型</span>}</div></article>)}</div></section>}
    {searched && !loading && results.length === 0 && !error && <div className="panel empty">没有找到可显示的结果。试试立创 C 编号或更短的型号关键词。</div>}
  </div>;
}

