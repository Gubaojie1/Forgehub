"use client";
import { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { authFetch, downloadWithAuth } from "@/lib/client-auth";
import styles from "./PrototypeWorkspace.module.css";

type Group = { id: string; name: string; current_version_id: string | null };
type Version = { id: string; prototype_id: string; version: string; change_note: string; file_name: string; uploaded_by: string; created_at: string; size: number; share_active?: number; share_token?: string | null };
type Data = { productId: string; productName: string; prototypes: Group[]; versions: Version[]; previewOrigin: string | null; shareOrigin: string | null; canUpload: boolean; canManage: boolean; maxBytes: number };
type Manage = { kind: "rename"; group: Group } | { kind: "edit"; version: Version } | { kind: "replace"; version: Version };
type Preview = { html: string; namespace: string; versionId: string; origin: string; channel: string; title: string; groupId: string };
type Note = { id: string; body: string; selector: string; x: number; y: number; created_by: string; created_at: string; canDelete?: boolean };
function notePins(items: { id: string; body: string; selector: string; x: number; y: number }[], draft?: { selector?: string; x: number; y: number } | null) {
  const pins = items.map((note, index) => ({ id: note.id, body: note.body, selector: note.selector, x: note.x, y: note.y, n: index + 1 }));
  if (draft) pins.push({ id: 'draft', body: '正在填写', selector: draft.selector || '', x: draft.x, y: draft.y, n: pins.length + 1 });
  return pins;
}
async function json(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || "操作失败"); return data; }
export function PrototypeWorkspace({ productId, shared = false }: { productId?: string; shared?: boolean }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [upload, setUpload] = useState<string | null>(null), [manage, setManage] = useState<Manage | null>(null), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [status, setStatus] = useState("");
  const [width, setWidth] = useState("100%"), [origin, setOrigin] = useState("");
  const [notes, setNotes] = useState<Note[]>([]), [draft, setDraft] = useState<{ selector: string; x: number; y: number } | null>(null), [noteBody, setNoteBody] = useState(""), [annotating, setAnnotating] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null), panel = useRef<HTMLDivElement>(null), notesRef = useRef<Note[]>([]), draftRef = useRef<{ selector: string; x: number; y: number } | null>(null);
  const queryRef = useRef(""), requestId = useRef(0), previewRequest = useRef(0), opened = useRef(false);
  const reload = useCallback(async () => {
    const seq = ++requestId.current;
    try {
      const result = await json(await authFetch(`/api/prototypes?${queryRef.current}`, { cache: "no-store" }));
      if (seq === requestId.current) { setData(result); setError(""); return result as Data; }
    } catch (e) { if (seq === requestId.current) setError(e instanceof Error ? e.message : "加载失败"); }
    return null;
  }, []);
  const open = useCallback(async (version: Version, group: Group, current: Data) => {
    const seq = ++previewRequest.current;
    setError(""); setStatus("正在加载原型…"); setPreview(null); setNotes([]);
    try {
      const origin = current.previewOrigin;
      if (!origin) throw new Error("管理员尚未配置原型预览服务。文件可以上传，配置完成后即可预览。");
      const url = new URL(origin);
      if (url.origin === location.origin || !['http:', 'https:'].includes(url.protocol)) throw new Error("预览地址必须与研发平台分开，请联系管理员检查配置");
      if (location.protocol === 'https:' && url.protocol !== 'https:') throw new Error("HTTPS 平台必须配置 HTTPS 预览地址");
      const result = await json(await authFetch(`/api/prototypes/versions/${version.id}`, { cache: "no-store" }));
      if (seq !== previewRequest.current) return;
      // getRandomValues is also supported on the existing HTTP/IP deployment.
      const channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      setPreview({ ...result, origin: url.origin, channel, title: `${group.name} · ${version.version}`, groupId: group.id });
    } catch (e) { if (seq === previewRequest.current) { setError(e instanceof Error ? e.message : "预览失败"); setStatus(""); } }
  }, []);
  useEffect(() => { setOrigin(location.origin); }, []);
  useEffect(() => { notesRef.current = notes; draftRef.current = draft; }, [notes, draft]);
  useEffect(() => {
    if (!preview) return;
    frame.current?.contentWindow?.postMessage({ type: 'notes', channel: preview.channel, notes: notePins(notes, draft) }, preview.origin);
  }, [preview, notes, draft]);
  useEffect(() => {
    setDraft(null); setAnnotating(false); setNoteBody(''); setNotes([]);
    if (!preview) return;
    let active = true;
    void (async () => {
      try {
        const result = await json(await authFetch(`/api/prototypes/versions/${preview.versionId}/notes`, { cache: 'no-store' }));
        if (active) setNotes(result.notes ?? []);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '批注加载失败'); }
    })();
    return () => { active = false; };
  }, [preview]);
  useEffect(() => {
    const query = new URLSearchParams(location.search), groupId = shared ? query.get('prototype') : null;
    if (shared && !groupId) { setError('链接缺少原型信息，请从产品内复制原型链接'); return; }
    queryRef.current = groupId ? `prototype=${encodeURIComponent(groupId)}` : `productId=${encodeURIComponent(productId ?? '')}`;
    opened.current = false; setData(null); setPreview(null);
    void reload().then(result => {
      if (!result || !shared || opened.current) return;
      opened.current = true;
      const group = result.prototypes.find(item => item.id === groupId);
      const version = result.versions.find(item => item.id === (query.get('version') || group?.current_version_id) && item.prototype_id === groupId);
      if (group && version) void open(version, group, result); else setError('该原型尚未设置当前版本，或链接中的版本不存在');
    });
    const timer = setInterval(() => { if (!document.hidden) void reload(); }, 30000);
    return () => { clearInterval(timer); requestId.current++; previewRequest.current++; };
  }, [productId, shared, reload, open]);
  useEffect(() => {
    if (!preview) return;
    setStatus('正在连接预览服务…');
    const timer = setTimeout(() => setStatus('预览服务连接超时，请检查服务和浏览器存储设置，再重新打开预览。'), 15000);
    function receive(event: MessageEvent) {
      if (!preview || event.source !== frame.current?.contentWindow || event.origin !== preview.origin || event.data?.channel !== preview.channel) return;
      if (event.data.type === 'ready') frame.current?.contentWindow?.postMessage({ type: 'load', ...preview }, preview.origin);
      if (event.data.type === 'loaded' || event.data.type === 'reset-done') { clearTimeout(timer); setStatus(event.data.type === 'reset-done' ? '演示数据已重置' : ''); frame.current?.contentWindow?.postMessage({ type: 'notes', channel: preview.channel, notes: notePins(notesRef.current, draftRef.current) }, preview.origin); }
      if (event.data.type === 'annotate-pick') { setAnnotating(false); setDraft({ selector: String(event.data.selector || '').slice(0, 400), x: Number(event.data.x), y: Number(event.data.y) }); setNoteBody(''); }
      if (event.data.type === 'error') { clearTimeout(timer); setStatus(String(event.data.message || '预览出现问题')); }
    }
    window.addEventListener('message', receive);
    return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [preview]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const form = new FormData(event.currentTarget); form.set('productId', data.productId);
    if (upload) form.set('prototypeId', upload);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > data.maxBytes) { setError('请选择非空 HTML 文件，大小不超过 10 MB'); return; }
    setBusy(true); setError('');
    try {
      const result = await json(await authFetch('/api/prototypes', { method: 'POST', body: form }));
      setUpload(null); setNotice('上传成功。请先预览，再设为当前版本。');
      const next = await reload();
      const version = next?.versions.find(v => v.id === result.id), group = next?.prototypes.find(g => g.id === result.prototypeId);
      if (next && version && group) await open(version, group, next);
    } catch (e) { setError(e instanceof Error ? e.message : '上传失败'); }
    finally { setBusy(false); }
  }
  async function publish(group: Group, version: Version) {
    if (busy || !confirm(`将“${group.name}”的 ${version.version} 设为当前版本？正在查看旧版本的同事不会被强制切换。`)) return;
    setBusy(true); setError('');
    try {
      await json(await authFetch(`/api/prototypes/${group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: version.id, expectedCurrentId: group.current_version_id }) }));
      setNotice('当前版本已更新，历史版本仍保留'); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败'); await reload(); }
    finally { setBusy(false); }
  }
  async function publishShare(version: Version) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await json(await authFetch(`/api/prototypes/versions/${version.id}/share`, { method: 'POST' }));
      const url = String(result.url || '').startsWith('http') ? result.url : new URL(result.path || `/prototype/s/${result.token}`, location.origin).href;
      try { await navigator.clipboard.writeText(url); setNotice('公开链接已复制'); } catch { setNotice('请复制下方公开链接'); }
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : '公开分享失败'); }
    finally { setBusy(false); }
  }
  async function stopShare(version: Version) {
    if (busy || !confirm('停止后，已经发出的公开链接会失效。')) return;
    setBusy(true); setError('');
    try {
      await json(await authFetch(`/api/prototypes/versions/${version.id}/share`, { method: 'DELETE' }));
      setNotice('已停止公开分享'); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : '停止分享失败'); }
    finally { setBusy(false); }
  }
  async function saveNote() {
    if (!preview || !draft || busy) return;
    setBusy(true); setError('');
    try {
      const result = await json(await authFetch(`/api/prototypes/versions/${preview.versionId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: noteBody, selector: draft.selector, x: draft.x, y: draft.y }) }));
      setNotes(result.notes ?? []); setDraft(null); setNoteBody(''); setNotice('批注已保存');
    } catch (e) { setError(e instanceof Error ? e.message : '批注保存失败'); }
    finally { setBusy(false); }
  }
  async function saveManage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!manage || !data || busy) return;
    const form = new FormData(event.currentTarget);
    if (manage.kind === "replace") {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size || file.size > data.maxBytes) { setError("请选择非空 HTML 文件，大小不超过 10 MB"); return; }
    }
    setBusy(true); setError("");
    try {
      if (manage.kind === "rename") await json(await authFetch(`/api/prototypes/${manage.group.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name") }) }));
      if (manage.kind === "edit") await json(await authFetch(`/api/prototypes/versions/${manage.version.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: form.get("version"), changeNote: form.get("changeNote") }) }));
      if (manage.kind === "replace") {
        await json(await authFetch(`/api/prototypes/versions/${manage.version.id}`, { method: "PUT", body: form }));
        if (preview?.versionId === manage.version.id) setPreview(null);
      }
      setManage(null); setNotice(manage.kind === "replace" ? "文件已替换" : "已保存"); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }
  async function removeVersion(version: Version) {
    if (busy || !confirm("删除后，这个版本的公开链接会失效。")) return;
    setBusy(true); setError("");
    try {
      await json(await authFetch(`/api/prototypes/versions/${version.id}`, { method: "DELETE" }));
      if (preview?.versionId === version.id) setPreview(null);
      setNotice("版本已删除"); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "删除失败"); }
    finally { setBusy(false); }
  }
  async function removeGroup(group: Group) {
    if (busy || !confirm("删除后，这个原型的公开链接会失效。")) return;
    setBusy(true); setError("");
    try {
      await json(await authFetch(`/api/prototypes/${group.id}`, { method: "DELETE" }));
      if (preview?.groupId === group.id) setPreview(null);
      setNotice("原型已删除"); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "删除失败"); }
    finally { setBusy(false); }
  }
  async function removeNote(note: Note) {
    if (!preview || busy || !confirm('删除这条批注？')) return;
    setBusy(true); setError('');
    try {
      await json(await authFetch(`/api/prototypes/versions/${preview.versionId}/notes?id=${encodeURIComponent(note.id)}`, { method: 'DELETE' }));
      setNotes(current => current.filter(item => item.id !== note.id)); setNotice('批注已删除');
    } catch (e) { setError(e instanceof Error ? e.message : '删除批注失败'); }
    finally { setBusy(false); }
  }
  const shown = data?.prototypes.filter(g => !shared || g.id === new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('prototype')) ?? [];
  const previewGroup = data?.prototypes.find(g => g.id === preview?.groupId);
  const currentChanged = previewGroup?.current_version_id && previewGroup.current_version_id !== preview?.versionId;
  return <section className={styles.workspace}>
    <header className={styles.heading}><div><h2>软件原型{shared && data ? ` · ${data.productName}` : ''}</h2></div><div className={styles.actions}><button className="btn" onClick={() => void reload()}>刷新列表</button>{data?.canUpload && !shared && <button className="btn primary" onClick={() => { setUpload(''); setError(''); }}>＋ 上传新原型</button>}</div></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className="form-note" role="status">{notice}</p>}
    {!data && !error && <p>正在加载原型…</p>}
    {data && !shown.length && <div className="panel empty">尚未上传软件原型。</div>}
    {shown.map(group => <article className="panel" key={group.id}>
      <div className="panel-head"><div><strong>{group.name}</strong></div><div className={styles.actions}>{data?.canUpload && <button className="btn small" onClick={() => setUpload(group.id)}>上传新版本</button>}{data?.canManage && <button className="btn small" disabled={busy} onClick={() => setManage({ kind: "rename", group })}>编辑</button>}{data?.canManage && <button className="btn small danger" disabled={busy} onClick={() => void removeGroup(group)}>删除</button>}</div></div>
      <div className="table-wrap"><table><thead><tr><th>版本</th><th>说明 / 文件</th><th>上传信息</th><th>操作</th></tr></thead><tbody>{data?.versions.filter(v => v.prototype_id === group.id).map(version => <Fragment key={version.id}>
        <tr><td>{version.version} {group.current_version_id === version.id && <span className="badge green">当前</span>}</td><td>{version.change_note || '暂无修改说明'}<small className={styles.sub}>{version.file_name} · {Math.ceil(version.size / 1024)} KB</small></td><td>{version.uploaded_by}<small className={styles.sub}>{new Date(version.created_at).toLocaleString()}</small></td><td><div className={styles.actions}>
          <button className="btn small primary" onClick={() => data && void open(version, group, data)}>在线预览</button>{version.share_active ? <button className="btn small" disabled={busy} onClick={() => void stopShare(version)}>停止分享</button> : <button className="btn small" disabled={busy} onClick={() => void publishShare(version)}>公开分享</button>}
          <button className="btn small" onClick={() => void downloadWithAuth(`/api/prototypes/versions/${version.id}?download=1`, version.file_name).catch(e => setError(e.message))}>下载</button>
          {data?.canUpload && group.current_version_id !== version.id && <button className="btn small" disabled={busy} title="请先在线预览确认" onClick={() => void publish(group, version)}>设为当前版本</button>}
          {data?.canManage && <button className="btn small" disabled={busy} onClick={() => setManage({ kind: "edit", version })}>编辑</button>}
          {data?.canManage && <button className="btn small" disabled={busy} onClick={() => setManage({ kind: "replace", version })}>替换</button>}
          {data?.canManage && <button className="btn small danger" disabled={busy} onClick={() => void removeVersion(version)}>删除</button>}
        </div></td></tr>
        {version.share_token && <tr><td colSpan={4}><label className={styles.share}>{group.name} {version.version} 公开链接<input readOnly value={data?.shareOrigin ? `${data.shareOrigin}/s/${version.share_token}` : `${origin}/prototype/s/${version.share_token}`} onFocus={event => event.target.select()} /></label></td></tr>}
        {!!version.share_active && !version.share_token && <tr><td colSpan={4}><p className="form-note">已有公开分享无法再次显示，请先停止分享，再重新公开分享。</p></td></tr>}
      </Fragment>)}</tbody></table></div>
    </article>)}
    {manage && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label={manage.kind === "rename" ? "编辑原型" : manage.kind === "edit" ? "编辑版本" : "替换文件"}><form onSubmit={event => void saveManage(event)}><div className="modal-head"><h2>{manage.kind === "rename" ? "编辑原型" : manage.kind === "edit" ? "编辑版本" : "替换文件"}</h2><button type="button" className="icon-button" disabled={busy} onClick={() => setManage(null)}>×</button></div><div className="modal-body">
      {manage.kind === "rename" && <label className="field">原型名称<input name="name" required maxLength={80} defaultValue={manage.group.name} /></label>}
      {manage.kind === "edit" && <><label className="field">版本号<input name="version" required maxLength={40} defaultValue={manage.version.version} /></label><label className="field">修改说明<textarea name="changeNote" maxLength={2000} defaultValue={manage.version.change_note} /></label></>}
      {manage.kind === "replace" && <label className="field">HTML 文件<input name="file" type="file" accept=".html,.htm" required /></label>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div><div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={() => setManage(null)}>取消</button><button className="btn primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</button></div></form></div></div>}
    {upload !== null && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="上传软件原型"><form onSubmit={submit}><div className="modal-head"><h2>{upload ? '上传原型新版本' : '上传新原型'}</h2><button type="button" className="icon-button" disabled={busy} onClick={() => setUpload(null)}>×</button></div><div className="modal-body">
      {!upload && <label className="field">原型名称<input name="name" required maxLength={80} placeholder="例如：睡眠调理机管理后台" /></label>}
      <label className="field">版本号<input name="version" required maxLength={40} placeholder="例如 V2.3" /></label><label className="field">修改说明<textarea name="changeNote" maxLength={2000} /></label>
      <label className="field">HTML 文件<input name="file" type="file" accept=".html,.htm" required /></label>{error && <p role="alert" className={styles.error}>{error}</p>}
    </div><div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={() => setUpload(null)}>取消</button><button className="btn primary" type="submit" disabled={busy}>{busy ? '上传中，请稍候…' : '上传并预览'}</button></div></form></div></div>}
    {preview && <div ref={panel} className={styles.preview}>
      <div className={styles.heading}><strong>{preview.title} · 交互原型</strong><div className={styles.actions}><select aria-label="预览宽度" value={width} onChange={e => setWidth(e.target.value)}><option value="100%">自适应</option><option value="1440px">电脑 1440px</option><option value="390px">手机 390px</option></select>
        <button className="btn small" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void panel.current?.requestFullscreen().catch(() => setNotice('浏览器暂不支持全屏，可使用新窗口')); }}>全屏</button>
        <button className="btn small" onClick={() => { const url = `/prototype?prototype=${encodeURIComponent(preview.groupId)}&version=${encodeURIComponent(preview.versionId)}`; window.open(url, '_blank', 'noopener,noreferrer'); }}>新窗口（需登录）</button>
        <button className="btn small" onClick={() => { const next = !annotating; setAnnotating(next); setDraft(null); frame.current?.contentWindow?.postMessage({ type: 'annotate', channel: preview.channel, enabled: next }, preview.origin); }}>{annotating ? '取消点选' : '添加批注'}</button>
        <button className="btn small" onClick={() => { if (confirm('重置本浏览器中这一版的演示数据？')) { setStatus('正在重置演示数据…'); frame.current?.contentWindow?.postMessage({ type: 'reset', channel: preview.channel }, preview.origin); } }}>重置演示数据</button>
        <button className="btn small" onClick={() => { previewRequest.current++; setPreview(null); }}>关闭预览</button></div></div>
      {currentChanged && <p className="form-note">你正在查看非当前版本。<button className="btn small" onClick={() => { const v = data?.versions.find(v => v.id === previewGroup.current_version_id); if (v && data) void open(v, previewGroup, data); }}>切换到当前版本</button></p>}
      {status && <p role="status" className="form-note">{status}</p>}
      <div className={styles.viewport}><iframe key={preview.channel} ref={frame} src={`${preview.origin}/#channel=${preview.channel}`} title="软件原型预览" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerPolicy="no-referrer" style={{ width }} /></div>
      {draft && <form className={styles.composer} onSubmit={event => { event.preventDefault(); void saveNote(); }}><label className="field">批注<textarea value={noteBody} onChange={event => setNoteBody(event.target.value)} maxLength={1000} required /></label><div className={styles.actions}><button className="btn small" type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button><button className="btn small primary" type="submit" disabled={busy}>保存批注</button></div></form>}
      {notes.length > 0 && <div className={styles.notes}>{notes.map((note, index) => <article className={styles.note} key={note.id}><button type="button" className={styles.mark} onClick={() => frame.current?.contentWindow?.postMessage({ type: 'focus-note', channel: preview.channel, id: note.id }, preview.origin)}>{index + 1}</button><div><p>{note.body}</p><small>{note.created_by} · {new Date(note.created_at).toLocaleString()}</small></div>{note.canDelete && <button className="btn small" type="button" disabled={busy} onClick={() => void removeNote(note)}>删除</button>}</article>)}</div>}
    </div>}
  </section>;
}
