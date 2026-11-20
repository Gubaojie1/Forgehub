import { selfhostCookieName } from "@/lib/selfhost-auth";

export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${selfhostCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
