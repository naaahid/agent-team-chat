import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/guard";
import { generateCode, hashCode } from "@/lib/codes";

type Params = { params: Promise<{ seatId: string }> };

/**
 * Owner-only code management for one seat.
 * Body: { action: "revoke" | "regenerate" }
 * "regenerate" returns the new plaintext code once and kills the old one.
 */
export async function POST(req: Request, { params }: Params) {
  const { error } = await requireOwner();
  if (error) return error;
  const seatId = Number((await params).seatId);
  const seat = await prisma.seat.findUnique({
    where: { id: seatId },
    include: { code: true },
  });
  if (!seat) return NextResponse.json({ error: "Seat not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "revoke") {
    if (seat.code) {
      await prisma.accessCode.update({
        where: { id: seat.code.id },
        data: { revoked: true },
      });
    }
    // Also kill live sessions — a revoked code should mean "out".
    await prisma.session.updateMany({
      where: { seatId, revoked: false },
      data: { revoked: true },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "regenerate") {
    const plainCode = generateCode(seat.kind === "agent" ? "AGENT" : seat.role === "Owner" ? "OWNER" : "TEAM");
    if (seat.code) {
      await prisma.accessCode.update({
        where: { id: seat.code.id },
        data: { codeHash: await hashCode(plainCode), revoked: false, createdAt: new Date() },
      });
    } else {
      await prisma.accessCode.create({
        data: { seatId, codeHash: await hashCode(plainCode) },
      });
    }
    return NextResponse.json({ ok: true, code: plainCode });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
