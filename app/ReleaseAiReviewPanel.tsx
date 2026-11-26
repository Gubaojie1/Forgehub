"use client";

import { useState } from "react";
import { authFetch } from "@/lib/client-auth";
import type { ReleaseAiReview, ReviewEvidence } from "@/lib/release-ai-review";

const coverageLabel = { covered: "已覆盖且通过", partial: "部分覆盖", missing: "未找到报告证据", failed: "有相关测试未通过" };
const coverageColor = { covered: "green", partial: "amber", missing: "amber", failed: "red" };
const historyLabel = { fixed: "开发说明本次修复", deferred: "本次暂不处理", unaffected: "说明不受影响", unmentioned: "未找到开发说明" };
type Download = (id: string, name: string) => void;

function Evidence({ items, download }: { items: ReviewEvidence[]; download: Download }) {
  if (!items.length) return null;
  return <ul className="ai-review-evidence">{items.map((item) => <li key={item.id}>
    {item.artifactId ? <button type="button" className="text-button" onClick={() => download(item.artifactId!, item.label)}>{item.label}</button> : item.label}
    {item.sheet && <> · {item.sheet} · 第 {item.row} 行</>}
    <div>{item.text}</div>
  </li>)}</ul>;
}

export function ReleaseAiReviewPanel({ requestId, onDownload }: { requestId: string; onDownload: Download }) {
  const [result, setResult] = useState<ReleaseAiReview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await authFetch(`/api/release-requests/${encodeURIComponent(requestId)}/ai-review`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "AI 评审暂不可用");
      setResult(body as ReleaseAiReview);
    } catch (error) {
      setError(error instanceof Error ? error.message : "AI 评审暂不可用");
    } finally {
      setPending(false);
    }
  }

  return <section className="ai-release-review" aria-label="AI 发布评审">
    <div className="ai-review-head">
      <div><strong>AI 发布评审</strong><div className="panel-sub">检查测试覆盖和历史问题回归，仅供参考，不影响审批。</div></div>
      <button type="button" className="btn small" disabled={pending} onClick={() => void generate()}>{pending ? "评审中…" : result ? "重新生成" : "生成 AI 评审"}</button>
    </div>
    {pending && <p role="status">正在读取本轮测试报告并对照变更说明，你可以继续审批。</p>}
    {error && <p className="form-note" role="alert">{error}</p>}
    {result && <div aria-live="polite">
      {!!result.warnings.length && <ul className="form-note">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <h4>本次更新的测试覆盖</h4>
      {result.changes.length ? <ul className="ai-review-findings">{result.changes.map((item) => <li key={item.source.id}>
        <strong>{item.source.text}</strong> <span className={`badge ${coverageColor[item.coverage]}`}>{coverageLabel[item.coverage]}</span>
        {item.note && <p>{item.note}</p>}
        <Evidence items={item.evidence} download={onDownload} />
      </li>)}</ul> : <p>没有可对照的开发更新说明。</p>}
      <h4>历史已知问题和回归</h4>
      {result.history.length ? <ul className="ai-review-findings">{result.history.map((item) => <li key={item.source.id}>
        <div className="panel-sub">{item.source.label}</div>
        <strong>{item.source.text}</strong> <span className="badge">{historyLabel[item.handling]}</span>
        {item.handling === "fixed" && <> <span className={`badge ${coverageColor[item.coverage]}`}>回归：{coverageLabel[item.coverage]}</span></>}
        {item.note && <p>{item.note}</p>}
        <Evidence items={[...item.development, ...item.evidence]} download={onDownload} />
      </li>)}</ul> : <p>未找到该产品近期版本的历史已知问题记录。</p>}
    </div>}
  </section>;
}
