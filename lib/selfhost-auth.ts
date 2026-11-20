const COOKIE_NAME = "forgehub_session";

type SessionPayload = { email: string; name: string; expiresAt: number; mustChangePassword?: boolean };
const PASSWORD_ITERATIONS = 210_000;

function toBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return new Uint8Array([...binary].map((character) => character.charCodeAt(0)));
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET 必须至少包含 32 个字符");
  return value;
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function equal(left: string, right: string) {
  const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right);
  if (a.byteLength !== b.byteLength) return false;
  let result = 0; for (let index = 0; index < a.byteLength; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

export async function createSession(email: string, name: string, mustChangePassword = false) {
  const payload = toBase64Url(JSON.stringify({ email, name, expiresAt: Date.now() + 12 * 60 * 60 * 1000, mustChangePassword } satisfies SessionPayload));
  return `${payload}.${await sign(payload)}`;
}

export async function verifySession(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !equal(signature, await sign(payload))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as SessionPayload;
    if (!parsed.email || !parsed.name || parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch { return null; }
}

export function sessionTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return null;
}

export async function passwordMatches(candidate: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected.length < 10) throw new Error("ADMIN_PASSWORD 必须至少包含 10 个字符");
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([digest(candidate), digest(expected)]);
  let result = 0; for (let index = 0; index < left.byteLength; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

async function derivePassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: PASSWORD_ITERATIONS }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

export async function hashPassword(password: string) {
  if (password.length < 10) throw new Error("密码至少需要 10 个字符");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await derivePassword(password, salt), salt: toBase64Url(salt) };
}

export async function userPasswordMatches(candidate: string, salt: string, expectedHash: string) {
  if (!candidate || !salt || !expectedHash) return false;
  return equal(await derivePassword(candidate, fromBase64Url(salt)), expectedHash);
}

export const selfhostCookieName = COOKIE_NAME;
