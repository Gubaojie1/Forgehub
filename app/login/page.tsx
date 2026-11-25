"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setTabSession } from "@/lib/client-auth";

function LoginForm() {
  const router = useRouter(); const searchParams = useSearchParams();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "登录失败，请稍后重试"); return; }
      if (!result.token) { setError("登录令牌生成失败，请稍后重试"); return; }
      setTabSession(result.token);
      if (result.mustChangePassword) { router.replace("/change-password"); router.refresh(); return; }
      const returnTo = searchParams.get("returnTo"); router.replace(returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"); router.refresh();
    } catch {
      setError("无法连接服务器，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page"><section className="login-card"><div className="brand-mark"><img className="brand-logo" src="/dnake-mark.png" alt="DNAKE" /></div><div><h1>脑机交互研发平台</h1></div><form onSubmit={submit}><label className="field"><span>邮箱或账号</span><input name="email" type="email" autoComplete="username" placeholder="name@dnake.com" required autoFocus /></label><label className="field"><span>密码</span><input name="password" type="password" autoComplete="current-password" required /></label>{error ? <div className="login-error" role="alert">{error}</div> : null}<button className="btn primary login-submit" disabled={busy}>{busy ? "正在登录…" : "进入平台"}</button></form></section></main>;
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
