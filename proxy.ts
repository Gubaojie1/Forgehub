import { NextRequest, NextResponse } from "next/server";
import { isShareToken } from "@/lib/share-token";
import { sessionTokenFromRequest, verifySession } from "@/lib/selfhost-auth";

export async function proxy(request: NextRequest) {
  if (process.env.SELF_HOSTED !== "true") return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  // The prototype shell and a single public share are readable without a session.
  // Creating or closing a share, and every other prototype API, still require login.
  const publicShare = pathname.startsWith("/prototype/s/") ? pathname.slice("/prototype/s/".length) : "";
  const shortShare = pathname.startsWith("/s/") ? pathname.slice("/s/".length) : "";
  const publicShareApi = pathname.startsWith("/api/prototypes/shares/") ? pathname.slice("/api/prototypes/shares/".length) : "";
  if (pathname === "/prototype" || isShareToken(publicShare) || isShareToken(shortShare)) return NextResponse.next();
  if (request.method === "GET" && isShareToken(publicShareApi)) return NextResponse.next();
  const isUnsafeApiRequest = pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (isUnsafeApiRequest) {
    const origin = request.headers.get("origin");
    try {
      // In production the application runs behind Nginx. `nextUrl.origin` is
      // therefore the private upstream address (127.0.0.1), while browsers
      // correctly send the public address in Origin. Compare against the
      // forwarded/public host instead of the upstream host.
      const originUrl = origin ? new URL(origin) : null;
      const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
      const publicHost = forwardedHost || request.headers.get("host");
      const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
      const publicProtocol = forwardedProtocol || request.nextUrl.protocol.replace(":", "");
      const isSamePublicOrigin = Boolean(
        originUrl &&
        publicHost &&
        originUrl.host === publicHost &&
        originUrl.protocol === `${publicProtocol}:`,
      );
      if (!isSamePublicOrigin) {
        return Response.json({ error: "请求来源校验失败" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "请求来源校验失败" }, { status: 403 });
    }
  }
  if (pathname === "/login" || pathname === "/" || pathname === "/change-password" || pathname.startsWith("/api/auth/") || pathname.startsWith("/_next/") || pathname === "/favicon.svg" || pathname === "/dnake-mark.png" || pathname === "/og.png") return NextResponse.next();

  const session = await verifySession(sessionTokenFromRequest(request));
  if (!session) {
    if (pathname.startsWith("/api/")) return Response.json({ error: "登录已失效，请重新登录" }, { status: 401 });
    const login = new URL("/login", request.url); login.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(login);
  }

  const passwordChangePath = pathname === "/change-password" || pathname.startsWith("/api/auth/") || pathname === "/api/auth/logout";
  if (session.mustChangePassword && !passwordChangePath) {
    if (pathname.startsWith("/api/")) return Response.json({ error: "首次登录需要先修改密码", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 });
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  const headers = new Headers(request.headers);
  headers.set("oai-authenticated-user-email", session.email);
  headers.set("oai-authenticated-user-full-name", encodeURIComponent(session.name));
  headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
