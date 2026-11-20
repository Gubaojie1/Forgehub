import { AccessError, getBucket, getD1, requireAccess, writeAudit } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const artifact = await getD1().prepare("SELECT a.*, r.channel AS release_channel, r.status AS release_status, r.trial_member_emails FROM artifacts a JOIN releases r ON r.id = a.release_id WHERE a.id = ?").bind(id).first<Record<string, string | number>>();
    if (!artifact) return Response.json({ error: "文件不存在" }, { status: 404 });
    const access = await requireAccess(request, "viewer");
    const isCollaborator = access.isAdmin
      || access.ownedProductIds.includes(String(artifact.product_id))
      || access.productIds.includes(String(artifact.product_id));
    const isTrialRelease = artifact.release_status === "已发布" && artifact.release_channel === "小范围试用";
    let isTrialMember = false;
    if (isTrialRelease) {
      try { isTrialMember = (JSON.parse(String(artifact.trial_member_emails ?? "[]")) as string[]).some((email) => email.toLowerCase() === access.email.toLowerCase()); } catch { isTrialMember = false; }
    }
    if (!access.isAdmin && ((isTrialRelease && !isTrialMember) || (!isTrialRelease && !isCollaborator))) {
      const workflowAccess = await getD1().prepare("SELECT id FROM release_requests WHERE release_id = ? AND lower(assigned_tester_email) = lower(?) LIMIT 1")
        .bind(String(artifact.release_id), access.email).first();
      if (!workflowAccess) throw new AccessError("您没有该固件文件的下载权限");
    }
    const object = await getBucket().get(String(artifact.object_key));
    if (!object) return Response.json({ error: "该条目为演示记录，尚未上传实体文件" }, { status: 404 });
    const name = String(artifact.name);
    const headers = new Headers(); object.writeHttpMetadata(headers);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    headers.set("X-Content-Type-Options", "nosniff"); headers.set("X-Firmware-SHA256", String(artifact.sha256));
    await writeAudit(access.email, "artifact.download", "artifact", String(artifact.id), `下载固件文件 ${name}`);
    return new Response(object.body, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "下载失败" }, { status: error instanceof AccessError ? error.status : 500 });
  }
}
