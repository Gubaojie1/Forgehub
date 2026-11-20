import { AccessError, getBucket, getD1, requireProductCollaboration, writeAudit } from "@/lib/storage";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const file = await getD1().prepare("SELECT product_id, file_name, object_key FROM product_files WHERE id = ?").bind(id).first<{ product_id: string; file_name: string; object_key: string }>();
    if (!file) return Response.json({ error: "产品资料不存在" }, { status: 404 });
    const access = await requireProductCollaboration(request, file.product_id); const object = await getBucket().get(file.object_key);
    if (!object) return Response.json({ error: "产品资料文件不存在" }, { status: 404 });
    await writeAudit(access.email, "product_file.download", "product", file.product_id, `下载产品资料 ${file.file_name}`);
    return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`, "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "产品资料下载失败" }, { status: error instanceof AccessError ? error.status : 500 }); }
}
