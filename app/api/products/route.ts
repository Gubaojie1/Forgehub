import { AccessError, getAccess, getD1, writeAudit } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const access = await getAccess(request);
    if (!access.canCreateProduct) throw new AccessError("只有管理员或已授权的产品负责人可以创建产品");
    const body = await request.json() as {
      code?: string; name?: string; family?: string; status?: string; description?: string; ownerEmail?: string;
      hardwareVariants?: Array<{ code?: string; mcu?: string; flashSize?: string; ramSize?: string; pcbVersion?: string; minBootloader?: string; interfaces?: string }>;
      assetTypes?: string[]; memberEmails?: string[];
    };
    const code = body.code?.trim().toUpperCase(); const name = body.name?.trim();
    const variants = (body.hardwareVariants ?? []).filter((item) => item.code?.trim());
    const assetTypes = Array.from(new Set(["产品立项书", "产品需求文档", ...(body.assetTypes ?? [])]));
    if (!code || !name || variants.length === 0) return Response.json({ error: "产品型号、名称和至少一个硬件版本不能为空" }, { status: 400 });
    const id = `p-${crypto.randomUUID()}`;
    const db = getD1(); const now = new Date().toISOString();
    let ownerEmail = access.email.toLowerCase();
    let ownerName = access.isSystemOwner ? "系统所有者" : access.displayName;
    if (body.ownerEmail?.trim()) {
      const requestedOwner = body.ownerEmail.trim().toLowerCase();
      const ownerUser = await db.prepare("SELECT email, display_name, status FROM users WHERE lower(email) = lower(?)").bind(requestedOwner).first<{ email: string; display_name: string; status: string }>();
      if (!ownerUser || ownerUser.status !== "active") return Response.json({ error: "请选择一名已启用的成员作为产品负责人" }, { status: 400 });
      ownerEmail = ownerUser.email.toLowerCase();
      ownerName = ownerUser.display_name;
    }
    const memberEmails = new Set((access.isAdmin ? body.memberEmails ?? [] : []).map((email) => email.trim().toLowerCase()).filter(Boolean));
    memberEmails.add(access.email.toLowerCase());
    memberEmails.add(ownerEmail);
    await db.batch([
      db.prepare("INSERT INTO products (id, code, name, family, hw_versions, owner, status, description, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, code, name, body.family?.trim() || "未分类", variants.map((item) => item.code!.trim().toUpperCase()).join(" / "), ownerName, body.status || "研发", body.description?.trim() || "", ownerEmail),
      ...variants.map((item) => db.prepare("INSERT INTO hardware_variants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(`hw-${crypto.randomUUID()}`, id, item.code!.trim().toUpperCase(), item.mcu?.trim() || "待补充", item.flashSize?.trim() || "待补充", item.ramSize?.trim() || "待补充", item.pcbVersion?.trim() || "待补充", item.minBootloader?.trim() || "无要求", item.interfaces?.trim() || "待补充", now)),
      ...assetTypes.map((assetType) => db.prepare("INSERT OR IGNORE INTO product_asset_types (product_id, asset_type) VALUES (?, ?)").bind(id, assetType)),
      ...Array.from(memberEmails).map((email) => db.prepare("INSERT OR IGNORE INTO product_permissions (user_email, product_id) VALUES (?, ?)").bind(email, id)),
    ]);
    await writeAudit(access.email, "product.create", "product", id, `创建产品 ${code} · ${name}，硬件版本 ${variants.map((item) => item.code).join("、")}`);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "产品创建失败";
    return Response.json({ error: message.includes("UNIQUE") ? "产品型号已经存在" : message }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
