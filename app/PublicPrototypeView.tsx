"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./PrototypeWorkspace.module.css";

type PublicNote = { id: string; body: string; selector: string; x: number; y: number; created_by: string; created_at: string };
type PublicPreview = { html: string; namespace: string; versionId: string; origin: string | null; title: string; channel: string; notes: PublicNote[] };
function notePins(items: PublicNote[]) {
  return items.map((note, index) => ({ id: note.id, body: note.body, selector: note.selector, x: note.x, y: note.y, n: index + 1 }));
}
export function PublicPrototypeView({ token }: { token: string }) {
  const [preview, setPreview] = useState<PublicPreview | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在打开公开原型…");
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/prototypes/shares/${token}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "分享链接已失效");
        if (!result.origin) throw new Error("管理员尚未配置原型预览服务");
        const url = new URL(result.origin);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("预览地址配置不正确");
        if (!active) return;
        const channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
        const notes = Array.isArray(result.notes) ? result.notes : [];
        setPreview({ html: result.html, namespace: result.namespace, versionId: result.versionId, origin: url.origin, title: result.title, channel, notes });
        setStatus("正在连接预览服务…");
      } catch (reason) {
        if (active) { setError(reason instanceof Error ? reason.message : "分享链接已失效"); setStatus(""); }
      }
    })();
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (!preview?.origin) return;
    const origin = preview.origin;
    const channel = preview.channel;
    const pins = notePins(preview.notes);
    const payload = { html: preview.html, namespace: preview.namespace, versionId: preview.versionId, origin, title: preview.title, channel };
    const timer = setTimeout(() => setStatus("预览服务连接超时，请检查网络是否能访问预览端口，再重新打开链接。"), 15000);
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || event.data?.channel !== channel) return;
      if (event.data.type === "ready") frame.current?.contentWindow?.postMessage({ type: "load", ...payload }, origin);
      if (event.data.type === "loaded" || event.data.type === "reset-done") { clearTimeout(timer); setStatus(""); frame.current?.contentWindow?.postMessage({ type: "notes", channel, notes: pins }, origin); }
      if (event.data.type === "error") { clearTimeout(timer); setStatus(String(event.data.message || "预览出现问题")); }
    }
    window.addEventListener("message", receive);
    return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [preview]);
  return <section className={styles.workspace}>
    <header className={styles.heading}><div><h2>{preview?.title || "软件原型"}</h2></div></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {status && <p role="status" className="form-note">{status}</p>}
    {preview?.origin && <div className={styles.viewport}><iframe key={preview.channel} ref={frame} src={`${preview.origin}/#channel=${preview.channel}`} title={preview.title} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerPolicy="no-referrer" style={{ width: "100%" }} /></div>}
    {preview && preview.notes.length > 0 && <div className={styles.notes}>{preview.notes.map((note, index) => <article className={styles.note} key={note.id}><button type="button" className={styles.mark} onClick={() => frame.current?.contentWindow?.postMessage({ type: "focus-note", channel: preview.channel, id: note.id }, preview.origin || "")}>{index + 1}</button><div><p>{note.body}</p><small>{note.created_by} · {new Date(note.created_at).toLocaleString()}</small></div></article>)}</div>}
  </section>;
}
