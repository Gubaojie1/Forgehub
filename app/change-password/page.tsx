"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch, setTabSession } from "@/lib/client-auth";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) { setError("两次输入的密码不一致"); setBusy(false); return; }
    const response = await authFetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword: password }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "密码修改失败"); setBusy(false); return; }
    if (result.token) setTabSession(result.token);
    router.replace("/"); router.refresh();
  }

  return <main className="login-page"><section className="login-card"><div className="brand-mark"><img className="brand-logo" src="/dnake-mark.png" alt="DNAKE" /></div><div><p className="eyebrow">DNAKE · FIRST SIGN-IN</p><h1>设置个人密码</h1><p className="login-copy">首次进入脑机交互研发平台，请将管理员提供的临时密码更换为你自己的密码。</p></div><form onSubmit={submit}><label className="field"><span>新密码</span><input name="newPassword" type="password" autoComplete="new-password" minLength={10} required autoFocus /></label><label className="field"><span>确认新密码</span><input name="confirmation" type="password" autoComplete="new-password" minLength={10} required /></label>{error ? <div className="login-error">{error}</div> : null}<button className="btn primary login-submit" disabled={busy}>{busy ? "正在保存…" : "保存并进入平台"}</button></form><small>密码至少需要 10 个字符</small></section></main>;
}
