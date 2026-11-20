import { AccessError, getBucket, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getD1();
    const file = await db.prepare("SELECT tool_id, product_id, file_name, object_key FROM tool_files WHERE id = ?").bind(id).first<{ tool_id: string; product_id: string | null; file_name: string; object_key: string }>();
    if (!file) return Response.json({ error: "工具文件不存在" }, { status: 404 });
    const access = await requireAccess(request, "viewer");
    const boundProducts = await db.prepare("SELECT product_id FROM tool_product_bindings WHERE tool_id = ?").bind(file.tool_id).all<{ product_id: string }>();
    if (boundProducts.results.length > 0) {
      const canUseTool = access.isAdmin || boundProducts.results.some((item) => access.ownedProductIds.includes(item.product_id) || access.productIds.includes(item.product_id));
      if (!canUseTool) throw new AccessError("您没有该产品工具的下载权限");
    }
    const object = await getBucket().get(file.object_key);
    if (!object) return Response.json({ error: "工具文件不存在" }, { status: 404 });
    await writeAudit(access.email, "tool_file.download", "tool", file.tool_id, `下载工具文件 ${file.file_name}`);
    return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`, "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "工具文件下载失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
