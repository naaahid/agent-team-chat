import bcrypt from "bcryptjs";
import crypto from "node:crypto";

// Readable code alphabet (no 0/O/1/I/L confusion).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCode(prefix = "TEAM"): string {
  const part = (n: number) =>
    Array.from(crypto.randomFillSync(new Uint8Array(n)))
      .map((b) => ALPHABET[b % ALPHABET.length])
      .join("");
  return `${prefix}-${part(4)}-${part(4)}`;
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeCode(code), 10);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalizeCode(code), hash);
}

/** Codes are case-insensitive and ignore surrounding spaces. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
];

export function nextColor(existingCount: number): string {
  return PALETTE[existingCount % PALETTE.length];
}

export function defaultAvatar(kind: string): string {
  return kind === "agent" ? "🤖" : "🧑";
}
