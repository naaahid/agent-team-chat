import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";

export const SESSION_COOKIE = "team_session";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const s =
    process.env.SESSION_SECRET ||
    "dev-only-secret-change-me-please-32chars";
  return new TextEncoder().encode(s);
}

export type SeatDTO = {
  id: number;
  name: string;
  kind: string;
  role: string;
  color: string;
  avatar: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
};

export function toSeatDTO(seat: {
  id: number;
  name: string;
  kind: string;
  role: string;
  color: string;
  avatar: string;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
}): SeatDTO {
  const online =
    seat.lastSeenAt != null && Date.now() - seat.lastSeenAt.getTime() < 3 * 60 * 1000;
  return {
    id: seat.id,
    name: seat.name,
    kind: seat.kind,
    role: seat.role,
    color: seat.color,
    avatar: seat.avatar,
    joinedAt: seat.joinedAt?.toISOString() ?? null,
    lastSeenAt: seat.lastSeenAt?.toISOString() ?? null,
    online,
  };
}

/** Create a DB session row + signed JWT for a seat. Returns the JWT. */
export async function createSession(seatId: number): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { id: sessionId, seatId, expiresAt },
  });
  const token = await new SignJWT({ sid: sessionId, seatId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret());
  return token;
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "1",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Resolve the current seat from the session cookie. Null if not signed in. */
export async function getCurrentSeat() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const sid = payload.sid as string | undefined;
    if (!sid) return null;
    const session = await prisma.session.findUnique({ where: { id: sid } });
    if (!session || session.revoked || session.expiresAt < new Date()) return null;
    const seat = await prisma.seat.findUnique({ where: { id: session.seatId } });
    if (!seat) return null;
    // Lightweight presence: touch lastSeenAt at most once per 30s.
    if (!seat.lastSeenAt || Date.now() - seat.lastSeenAt.getTime() > 30 * 1000) {
      await prisma.seat.update({
        where: { id: seat.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return seat;
  } catch {
    return null;
  }
}

export async function revokeCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return;
  try {
    const { payload } = await jwtVerify(token, secret());
    const sid = payload.sid as string | undefined;
    if (sid) {
      await prisma.session.updateMany({
        where: { id: sid },
        data: { revoked: true },
      });
    }
  } catch {
    // ignore — cookie is cleared regardless
  }
}
