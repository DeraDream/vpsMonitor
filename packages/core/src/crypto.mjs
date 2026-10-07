import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
export function tokenKey() { const secret = process.env.TOKEN_ENCRYPTION_KEY; return secret ? createHash("sha256").update(secret).digest() : null; }
export function encryptToken(value) {
  const key = tokenKey(); if (!key) throw new Error("服务器未设置 TOKEN_ENCRYPTION_KEY，不能保存 Bot Token");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}
export function decryptToken(value) {
  const key = tokenKey(); if (!key) throw new Error("服务器未设置 TOKEN_ENCRYPTION_KEY");
  const [version, ivText, tagText, encryptedText] = String(value || "").split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) throw new Error("Bot Token 密文无效，请重新保存");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64")); decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}
