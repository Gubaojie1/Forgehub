import { AccessError, DEFAULT_UPLOAD_MAX_MB, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function GET(request: Request) {
  try {
    await requireAccess(request, "viewer");
    const row = await getD1().prepare("SELECT value FROM settings WHERE key = 'upload_max_mb'").first<{ value: string }>();
    const maxMb = Number(row?.value ?? DEFAULT_UPLOAD_MAX_MB);
    return Response.json({ maxMb: Number.isFinite(maxMb) ? maxMb : DEFAULT_UPLOAD_MAX_MB });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法读取上传设置" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await requireAccess(request, "admin");
    const { maxMb } = await request.json() as { maxMb?: number };
    const value = Number(maxMb);
    if (!Number.isInteger(value) || value < 10 || value > 1024) return Response.json({ error: "单文件上限请设置为 10 至 1024 MB 的整数" }, { status: 400 });
    await getD1().prepare("INSERT INTO settings (key, value) VALUES ('upload_max_mb', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(value)).run();
    await writeAudit(access.email, "settings.upload_limit", "settings", "upload_max_mb", `将单文件上传上限调整为 ${value} MB`);
    return Response.json({ maxMb: value });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存上传设置失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
