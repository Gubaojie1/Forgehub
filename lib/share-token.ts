const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function isShareToken(token: string) {
  return /^[a-f0-9]{64}$/.test(token) || /^[A-Za-z0-9_-]{22}$/.test(token);
}

export function shareToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let token = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    token += alphabet[(chunk >> 18) & 63] + alphabet[(chunk >> 12) & 63];
    if (index + 1 < bytes.length) token += alphabet[(chunk >> 6) & 63];
    if (index + 2 < bytes.length) token += alphabet[chunk & 63];
  }
  return token;
}
