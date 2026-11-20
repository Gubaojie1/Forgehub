import { AccessError, requireAccess } from "@/lib/storage";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function findString(source: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    const value = key ? source[key] : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function GET(request: Request) {
  try {
    await requireAccess(request, "viewer");
    const params = new URL(request.url).searchParams;
    const modelUuid = params.get("model")?.trim() ?? "";
    if (!/^[a-z\d_-]{4,100}$/i.test(modelUuid)) return Response.json({ error: "无效的 3D 模型编号" }, { status: 400 });

    let downloadableModelUuid = modelUuid;
    try {
      const componentResponse = await fetch(`https://pro.lceda.cn/api/v2/components/${encodeURIComponent(modelUuid)}`, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 ForgeHub" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (componentResponse.ok) {
        const component = record(await componentResponse.json().catch(() => null));
        const result = record(component.result ?? component.Result);
        downloadableModelUuid = findString(result, "model3DUuid", "model3dUuid", "Model3DUuid") || modelUuid;
      }
    } catch { /* Legacy model IDs can be fetched directly below. */ }

    // Download from the same host used by the desktop downloader. The
    // modules.easyeda.com host can return AccessDenied for this object even
    // though modules.lceda.cn serves it successfully.
    const stepResponse = await fetch(`https://modules.lceda.cn/qAxj6KHrDKw4blvCG8QJPs7Y/${encodeURIComponent(downloadableModelUuid)}`, {
      headers: {
        Accept: "application/octet-stream, */*",
        "User-Agent": "Mozilla/5.0 ForgeHub",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });

    if (!stepResponse.ok) {
      return Response.json({ error: `立创文件服务返回 HTTP ${stepResponse.status}` }, { status: 502 });
    }

    const file = await stepResponse.arrayBuffer();
    if (file.byteLength === 0) return Response.json({ error: "立创文件服务返回了空文件" }, { status: 502 });
    if (file.byteLength > 100 * 1024 * 1024) return Response.json({ error: "STEP 文件超过 100 MB，无法通过网页下载" }, { status: 413 });

    const preview = new TextDecoder().decode(file.slice(0, Math.min(file.byteLength, 512))).trimStart();
    if (preview.startsWith("<") || preview.startsWith("{")) {
      return Response.json({ error: "立创文件服务未返回 STEP 文件，请稍后重试" }, { status: 502 });
    }

    return new Response(file, {
      headers: {
        "Content-Type": "application/step",
        "Content-Disposition": `attachment; filename="${downloadableModelUuid}.step"`,
        "Content-Length": String(file.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof AccessError ? error.status : 502;
    return Response.json({ error: error instanceof Error ? error.message : "STEP 下载失败，请稍后重试" }, { status });
  }
}
