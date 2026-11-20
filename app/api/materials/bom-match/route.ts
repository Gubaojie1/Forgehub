import { AccessError, getD1, requireAccess, writeAudit } from "@/lib/storage";

type MaterialRow = { id: string; name: string; category: string; available_quantity: number; reserved_quantity: number; publisher_name: string; note: string };
type AiMatch = { sourceIndex?: number; bomName?: string; quantity?: number | null; matches?: Array<{ materialId?: string; level?: string; reason?: string }> };

class ModelMatchError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

function extractLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50);
}

function decodeModelJson(value: string) {
  const cleaned = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "").trim();
  const json = cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1);
  if (!json) throw new ModelMatchError("AI 返回内容不是有效的匹配结果，请稍后重试");
  try {
    const parsed = JSON.parse(json) as { items?: AiMatch[] };
    if (!Array.isArray(parsed.items)) throw new Error();
    return parsed.items;
  } catch {
    throw new ModelMatchError("AI 返回格式异常，请稍后重试");
  }
}

async function readErrorMessage(response: Response) {
  const raw = (await response.text()).slice(0, 300);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch { /* use generic message */ }
  return "服务暂时不可用";
}

async function askQwen(rawBomLines: string[], materials: MaterialRow[]) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new ModelMatchError("AI 匹配服务尚未配置，请联系管理员", 503);
  const baseUrl = (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  // BOM 匹配不需要模型展开推理；关闭思考模式可显著缩短响应时间。
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: process.env.DASHSCOPE_MODEL || "qwen-flash", temperature: 0, max_tokens: 1800, enable_thinking: false, messages: [
        { role: "system", content: "你是研发物料匹配助手。先从原始 BOM 每一行中识别真实的物料型号/规格和需求数量；列位置不固定，可能有或没有表头，也可能是制表符、逗号或空格分隔。忽略序号、物料编码、位号和纯分类名（例如贴片IC、贴片电阻）。然后从 availableMaterials 中找出 0 到 3 个可能相关的研发物料。型号不一致、关键封装或参数无法确认时宁可返回空 matches，禁止根据类别相同就推荐，禁止声称物料可替代或兼容。只输出合法 JSON，不要 Markdown：{items:[{sourceIndex:number,bomName:string,quantity:number|null,matches:[{materialId:string,level:'推荐'|'疑似',reason:string}]}]}。跳过表头或无法识别型号的行。reason 不超过 18 个汉字。" },
        { role: "user", content: JSON.stringify({ rawBomLines: rawBomLines.map((content, sourceIndex) => ({ sourceIndex, content })), availableMaterials: materials.slice(0, 200).map((item) => ({ materialId: item.id, name: item.name, category: item.category, availableQuantity: Math.max(0, item.available_quantity - item.reserved_quantity), note: item.note })) }) },
      ] }),
    });
    if (!response.ok) throw new ModelMatchError(`AI 服务请求失败（${response.status}）：${await readErrorMessage(response)}`, response.status === 429 ? 429 : 502);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ModelMatchError("AI 未返回匹配内容，请稍后重试");
    return decodeModelJson(content);
  } catch (error) {
    if (error instanceof ModelMatchError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ModelMatchError("AI 匹配超过 60 秒仍未完成，请稍后重试或分批匹配", 504);
    throw new ModelMatchError("AI 服务连接异常，请稍后重试");
  } finally { clearTimeout(timer); }
}

export async function POST(request: Request) {
  try {
    const access = await requireAccess(request, "viewer");
    const body = await request.json() as { text?: string };
    if (!body.text || body.text.trim().length < 2) return Response.json({ error: "请粘贴至少一条物料信息" }, { status: 400 });
    if (body.text.length > 20000) return Response.json({ error: "一次最多匹配 50 条物料，请分批粘贴" }, { status: 400 });
    const rawBomLines = extractLines(body.text);
    if (!rawBomLines.length) return Response.json({ error: "未识别到可读取的 BOM 内容" }, { status: 400 });
    const materials = await getD1().prepare("SELECT id, name, category, available_quantity, reserved_quantity, publisher_name, note FROM surplus_materials WHERE status = '可领用' AND available_quantity > reserved_quantity ORDER BY updated_at DESC").all<MaterialRow>();
    const aiMatches = await askQwen(rawBomLines, materials.results);
    const materialById = new Map(materials.results.map((item) => [item.id, item]));
    const rows = aiMatches.filter((item) => typeof item.sourceIndex === "number" && typeof item.bomName === "string" && item.bomName.trim()).map((ai) => {
      const suggestions = (ai?.matches ?? []).slice(0, 3).flatMap((match) => {
        const material = match.materialId ? materialById.get(match.materialId) : undefined;
        if (!material) return [];
        return [{ materialId: material.id, name: material.name, category: material.category, availableQuantity: Math.max(0, material.available_quantity - material.reserved_quantity), publisherName: material.publisher_name, note: material.note, score: 0, level: match.level === "推荐" ? "推荐" : "疑似", reason: String(match.reason ?? "").slice(0, 60) }];
      });
      return { name: ai.bomName!.trim(), quantity: typeof ai.quantity === "number" && ai.quantity > 0 ? ai.quantity : null, suggestions };
    });
    if (!rows.length) return Response.json({ error: "AI 未能从这份 BOM 中识别出物料型号。请确认内容没有被截断后重试" }, { status: 422 });
    await writeAudit(access.email, "material.ai_bom_match", "material", "bom-match", `使用 AI 匹配 ${rawBomLines.length} 条 BOM 文本，不保存原始内容`);
    return Response.json({ rows, engine: "ai" });
  } catch (error) {
    const status = error instanceof AccessError ? error.status : error instanceof ModelMatchError ? error.status : 500;
    const message = error instanceof Error ? error.message : "BOM 匹配失败";
    return Response.json({ error: message }, { status });
  }
}
