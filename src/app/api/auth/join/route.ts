import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeed, postSystemMessage } from "@/lib/init";
import { verifyCode } from "@/lib/codes";
import { createSession, setSessionCookie, toSeatDTO } from "@/lib/auth";
import { clientIp, isLockedOut, recordFailure, clearFailures } from "@/lib/ratelimit";

export async function POST(req: Request) {
  await ensureSeed();

  const ip = clientIp(req);
  if (isLockedOut(ip)) {
    return NextResponse.json(
      { error: "Too many wrong attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  let code = "";
  try {
    const body = await req.json();
    code = typeof body?.code === "string" ? body.code : "";
  } catch {
    // fall through with empty code
  }
  if (!code.trim()) {
    recordFailure(ip);
    return NextResponse.json({ error: "Enter your access code." }, { status: 400 });
  }

  // Codes are few (a seat per person/agent), so compare against each
  // non-revoked hash. bcrypt compare keeps this safe against guessing.
  const codes = await prisma.accessCode.findMany({
    where: { revoked: false },
    include: { seat: true },
  });

  let matched: (typeof codes)[number] | null = null;
  for (const candidate of codes) {
    if (await verifyCode(code, candidate.codeHash)) {
      matched = candidate;
      break;
    }
  }

  if (!matched) {
    recordFailure(ip);
    return NextResponse.json({ error: "That code doesn't match any seat." }, { status: 401 });
  }

  clearFailures(ip);
  const seat = matched.seat;
  const firstJoin = !seat.joinedAt;

  await prisma.accessCode.update({
    where: { id: matched.id },
    data: { lastUsedAt: new Date() },
  });
  await prisma.seat.update({
    where: { id: seat.id },
    data: { joinedAt: seat.joinedAt ?? new Date(), lastSeenAt: new Date() },
  });

  const token = await createSession(seat.id);
  await setSessionCookie(token);

  if (firstJoin) {
    await postSystemMessage(
      "general",
      `${seat.avatar} ${seat.name} (${seat.kind === "agent" ? "Muse agent" : "human"}) joined the team.`
    );
  }

  const fresh = await prisma.seat.findUnique({ where: { id: seat.id } });
  return NextResponse.json({ seat: toSeatDTO(fresh!) });
}
