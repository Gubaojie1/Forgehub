import { createSession, hashPassword, selfhostCookieName, sessionTokenFromRequest, verifySession } from "@/lib/selfhost-auth";
import { ensureAndSeed, getD1, writeAudit } from "@/lib/storage";

export async function POST(request: Request) {
  if (process.env.SELF_HOSTED !== "true") return Response.json({ error: "该密码功能仅用于独立部署" }, { status: 404 });
  try {
    const session = await verifySession(sessionTokenFromRequest(request));
    if (!session) return Response.json({ error: "登录已失效，请重新登录" }, { status: 401 });

    const adminEmail = (process.env.ADMIN_EMAIL || "admin@forgehub.local").toLowerCase();
    if (session.email.toLowerCase() === adminEmail) return Response.json({ error: "主管理员密码需要在服务器配置中修改" }, { status: 400 });

    const body = await request.json() as { newPassword?: string };
    const password = body.newPassword ?? "";
    const { hash, salt } = await hashPassword(password);
    await ensureAndSeed();
    const db = getD1();
    const user = await db.prepare("SELECT display_name, status FROM users WHERE email = ?").bind(session.email).first<{ display_name: string; status: string }>();
    if (!user) return Response.json({ error: "账号不存在" }, { status: 404 });
    if (user.status === "disabled") return Response.json({ error: "该账号已被停用" }, { status: 403 });

    await db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE email = ?").bind(hash, salt, session.email).run();
    await writeAudit(session.email, "user.password.change", "user", session.email, "用户完成首次密码修改");
    const token = await createSession(session.email, user.display_name, false);
    const response = Response.json({ ok: true, token });
    const secure = process.env.COOKIE_SECURE === "true";
    response.headers.append("Set-Cookie", `${selfhostCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "密码修改失败" }, { status: 500 });
  }
}
