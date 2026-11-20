import { AccessError, requireAccess } from "@/lib/storage";

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function valueOf(source: AnyRecord, ...names: string[]): string {
  for (const name of names) {
    const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    const value = key ? source[key] : undefined;
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "";
}

function modelUuidFor(item: AnyRecord) {
  const attributes = record(item.attributes ?? item.Attributes);
  return valueOf(attributes, "3D Model", "3D model", "model3DUuid") || valueOf(item, "modelUuid", "model3DUuid");
}

export async function GET(request: Request) {
  try {
    await requireAccess(request, "viewer");
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 100) return Response.json({ error: "请输入 1 到 100 个字符的立创编号或关键词" }, { status: 400 });
    const upstream = await fetch(`https://pro.lceda.cn/api/szlcsc/eda/product/list?wd=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 ForgeHub" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) return Response.json({ error: `立创搜索暂不可用（HTTP ${upstream.status}）` }, { status: 502 });
    const payload = record(await upstream.json().catch(() => null));
    const rows = Array.isArray(payload.result) ? payload.result : Array.isArray(payload.Result) ? payload.Result : Array.isArray(payload.data) ? payload.data : [];
    const results = rows.slice(0, 30).map((value) => {
      const item = record(value);
      const footprint = record(item.footprint ?? item.Footprint);
      const images = item.images ?? item.Images;
      const imageUrl = Array.isArray(images) ? String(images[0] ?? "") : valueOf(item, "image", "imageUrl", "ImageUrl");
      return {
        id: valueOf(item, "uuid", "Uuid", "id", "ID") || crypto.randomUUID(),
        title: valueOf(item, "displayTitle", "DisplayTitle", "title", "name", "Name"),
        lcscPart: valueOf(item, "lcscPart", "lcscPartNumber", "productCode", "ProductCode", "code", "Code"),
        manufacturerPart: valueOf(item, "manufacturerPart", "ManufacturerPart", "manufacturerPartNumber", "model", "Model"),
        packageName: valueOf(footprint, "displayTitle", "DisplayTitle", "name", "Name"),
        imageUrl,
        modelUuid: modelUuidFor(item),
      };
    });
    return Response.json({ results });
  } catch (error) {
    const status = error instanceof AccessError ? error.status : 502;
    return Response.json({ error: error instanceof Error ? error.message : "立创搜索失败，请稍后重试" }, { status });
  }
}
