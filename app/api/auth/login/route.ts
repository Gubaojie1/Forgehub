import { createSession, passwordMatches, selfhostCookieName, userPasswordMatches } from "@/lib/selfhost-auth";
import { ensureAndSeed, getD1 } from "@/lib/storage";

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request, email: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `${ip}:${email}`;
}

function tooManyFailures(key: string) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) { failures.delete(key); return false; }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string) {
  const previous = failures.get(key);
  const resetAt = previous && previous.resetAt > Date.now() ? previous.resetAt : Date.now() + FAILURE_WINDOW_MS;
  failures.set(key, { count: previous && previous.resetAt === resetAt ? previous.count + 1 : 1, resetAt });
}

export async function POST(request: Request) {
  if (process.env.SELF_HOSTED !== "true") return Response.json({ error: "该登录方式仅用于独立部署" }, { status: 404 });
  try {
    const body = await request.json() as { email?: string; password?: string };
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@forgehub.local").toLowerCase();
    const email = body.email?.trim().toLowerCase() || adminEmail;
    const password = body.password ?? "";
    const key = clientKey(request, email);
    if (tooManyFailures(key)) return Response.json({ error: "登录尝试过于频繁，请 15 分钟后再试" }, { status: 429 });
    let displayName = process.env.ADMIN_DISPLAY_NAME || "管理员";
    let mustChangePassword = false;

    if (email === adminEmail) {
      if (!await passwordMatches(password)) recordFailure(key);
      if (!await passwordMatches(password)) return Response.json({ error: "邮箱或密码不正确" }, { status: 401 });
    } else {
      await ensureAndSeed();
      const user = await getD1().prepare("SELECT display_name, status, password_hash, password_salt, must_change_password FROM users WHERE email = ?").bind(email).first<{ display_name: string; status: string; password_hash: string | null; password_salt: string | null; must_change_password: number }>();
      if (!user?.password_hash || !user.password_salt || !await userPasswordMatches(password, user.password_salt, user.password_hash)) {
        recordFailure(key);
        return Response.json({ error: "邮箱或密码不正确" }, { status: 401 });
      }
      if (user.status === "disabled") return Response.json({ error: "该账号已被停用，请联系管理员" }, { status: 403 });
      displayName = user.display_name;
      mustChangePassword = Boolean(user.must_change_password);
    }

    failures.delete(key);
    const token = await createSession(email, displayName, mustChangePassword);
    const secure = process.env.COOKIE_SECURE === "true";
    const response = Response.json({ ok: true, mustChangePassword, token });
    response.headers.append("Set-Cookie", `${selfhostCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "登录失败" }, { status: 500 });
  }
}
