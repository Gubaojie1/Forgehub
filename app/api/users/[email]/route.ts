import { AccessError, getD1, getSystemOwnerEmail, requireAccess, UserRole, writeAudit } from "@/lib/storage";
import { hashPassword } from "@/lib/selfhost-auth";

export async function PATCH(request: Request, context: { params: Promise<{ email: string }> }) {
  try {
    const access = await requireAccess(request, "admin");
    const { email: encodedEmail } = await context.params; const email = decodeURIComponent(encodedEmail);
    const body = await request.json() as { displayName?: string; role?: UserRole; status?: "active" | "disabled"; productIds?: string[]; temporaryPassword?: string; canCreateProducts?: boolean };
    if (!body.role || !["viewer", "developer", "tester", "product_owner", "project_manager", "admin"].includes(body.role)) return Response.json({ error: "无效角色" }, { status: 400 });
    if (body.temporaryPassword && body.temporaryPassword.length < 10) return Response.json({ error: "临时密码至少需要 10 个字符" }, { status: 400 });
    const db = getD1(); const systemOwnerEmail = await getSystemOwnerEmail();
    if (systemOwnerEmail === email.toLowerCase()) throw new AccessError("系统所有者由服务器配置，不能在成员权限中修改");
    const existing = await db.prepare("SELECT email, display_name, role, status FROM users WHERE email = ?").bind(email).first<{ email: string; display_name: string; role: UserRole; status: string }>();
    if (!existing) return Response.json({ error: "成员不存在" }, { status: 404 });
    if ((existing.role === "admin" && body.role !== "admin") || (existing.role === "admin" && body.status === "disabled")) {
      const admins = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'").first<{ total: number }>();
      if ((admins?.total ?? 0) <= 1) throw new AccessError("系统必须至少保留一名启用的管理员");
    }
    const statements = [db.prepare("UPDATE users SET display_name = ?, role = ?, status = ?, can_create_products = ? WHERE email = ?").bind(body.displayName?.trim() || existing.display_name, body.role, body.status ?? existing.status, body.canCreateProducts ? 1 : 0, email)];
    if (body.temporaryPassword) {
      const adminEmail = (process.env.ADMIN_EMAIL || "admin@forgehub.local").toLowerCase();
      if (email.toLowerCase() === adminEmail) return Response.json({ error: "主管理员密码需要在服务器配置中修改" }, { status: 400 });
      const { hash, salt } = await hashPassword(body.temporaryPassword);
      statements.push(db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE email = ?").bind(hash, salt, email));
    }
    if (body.productIds) {
      statements.push(db.prepare("DELETE FROM product_permissions WHERE user_email = ?").bind(email));
      statements.push(...body.productIds.map((productId) => db.prepare("INSERT OR IGNORE INTO product_permissions (user_email, product_id) VALUES (?, ?)").bind(email, productId)));
    }
    await db.batch(statements);
    await writeAudit(access.email, "user.update", "user", email, `角色：${body.role}，状态：${body.status ?? existing.status}，创建产品：${body.canCreateProducts ? "允许" : "不允许"}，产品权限：${body.productIds?.length ?? "未变更"}`);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "权限更新失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ email: string }> }) {
  try {
    const access = await requireAccess(request, "admin");
    const { email: encodedEmail } = await context.params;
    const email = decodeURIComponent(encodedEmail).trim().toLowerCase();
    const db = getD1();
    const systemOwnerEmail = await getSystemOwnerEmail();
    if (systemOwnerEmail === email) throw new AccessError("系统所有者由服务器配置，不能删除");
    if (access.email.toLowerCase() === email) throw new AccessError("不能删除自己的账号");
    const existing = await db.prepare("SELECT email, display_name, role, status FROM users WHERE lower(email) = ?").bind(email).first<{ email: string; display_name: string; role: UserRole; status: string }>();
    if (!existing) return Response.json({ error: "成员不存在" }, { status: 404 });
    if (existing.role === "admin" && existing.status === "active") {
      const admins = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active'").first<{ total: number }>();
      if ((admins?.total ?? 0) <= 1) throw new AccessError("系统必须至少保留一名启用的管理员");
    }
    const owned = await db.prepare("SELECT name FROM products WHERE lower(owner_email) = ? ORDER BY name").bind(email).all<{ name: string }>();
    if (owned.results.length) throw new AccessError(`请先更换这些产品的负责人：${owned.results.map((item) => item.name).join("、")}`, 409);
    await db.batch([
      db.prepare("DELETE FROM product_permissions WHERE lower(user_email) = ?").bind(email),
      db.prepare("DELETE FROM users WHERE email = ?").bind(existing.email),
    ]);
    await writeAudit(access.email, "user.delete", "user", existing.email, `删除成员 ${existing.display_name}`);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof AccessError ? error.message : error instanceof Error ? error.message : "删除成员失败";
    return Response.json({ error: message }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
