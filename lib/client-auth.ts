"use client";

export const TAB_SESSION_KEY = "forgehub_tab_session";

export function getTabSession() {
  return typeof window === "undefined" ? null : window.sessionStorage.getItem(TAB_SESSION_KEY);
}

export function setTabSession(token: string) {
  window.sessionStorage.setItem(TAB_SESSION_KEY, token);
}

export function clearTabSession() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(TAB_SESSION_KEY);
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getTabSession();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    clearTabSession();
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return response;
}

export async function downloadWithAuth(url: string, fileName: string) {
  const response = await authFetch(url);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error ?? "下载失败");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export async function consumeCatalogEvents(onCatalog: () => void, signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const response = await authFetch("/api/events", { headers: { Accept: "text/event-stream" }, cache: "no-store", signal });
      if (!response.ok || !response.body) throw new Error("实时连接失败");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.split("\n").some((line) => line.trim() === "event: catalog")) onCatalog();
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      console.warn("Realtime connection interrupted", error);
    }
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 2_000);
      signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}
