import { AccessError, getD1, requireAccess, UserRole, writeAudit } from "@/lib/storage";
import { hashPassword } from "@/lib/selfhost-auth";

export async function POST(request: Request) {
  try {
    const access = await requireAccess(request, "admin");
    const body = await request.json() as { email?: string; displayName?: string; role?: UserRole; status?: "active" | "disabled"; productIds?: string[]; temporaryPassword?: string; canCreateProducts?: boolean };
    const email = body.email?.trim().toLowerCase(); const displayName = body.displayName?.trim();
    if (!email || !email.includes("@") || !displayName) return Response.json({ error: "请填写有效的姓名和邮箱" }, { status: 400 });
    if ((body.temporaryPassword ?? "").length < 10) return Response.json({ error: "临时密码至少需要 10 个字符" }, { status: 400 });
    const { hash, salt } = await hashPassword(body.temporaryPassword ?? "");
    const role = body.role && ["viewer", "developer", "tester", "product_owner", "project_manager", "admin"].includes(body.role) ? body.role : "viewer";
    const db = getD1(); const now = new Date().toISOString();
    await db.batch([
      db.prepare("INSERT INTO users (email, display_name, role, status, last_login_at, created_at, password_hash, password_salt, must_change_password, can_create_products) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1, ?)").bind(email, displayName, role, body.status ?? "active", now, hash, salt, body.canCreateProducts ? 1 : 0),
      ...(body.productIds ?? []).map((productId) => db.prepare("INSERT OR IGNORE INTO product_permissions (user_email, product_id) VALUES (?, ?)").bind(email, productId)),
    ]);
    await writeAudit(access.email, "user.create", "user", email, `添加成员 ${displayName}，角色 ${role}${body.canCreateProducts ? "，可创建产品" : ""}`);
    return Response.json({ email }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "添加成员失败";
    return Response.json({ error: message.includes("UNIQUE") ? "该邮箱已经存在" : message }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
