import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/guard";
import { generateCode, hashCode, nextColor, defaultAvatar } from "@/lib/codes";
import { toSeatDTO } from "@/lib/auth";

/**
 * Owner-only: create a new seat + access code (for a friend or an agent).
 * The plaintext code is returned exactly once — it is never stored.
 */
export async function POST(req: Request) {
  const { error } = await requireOwner();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const kind = body?.kind === "agent" ? "agent" : "human";
  const role = body?.role === "Leader" ? "Leader" : "Member";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const seatCount = await prisma.seat.count();
  const seat = await prisma.seat.create({
    data: {
      name: name.slice(0, 60),
      kind,
      role,
      color:
        typeof body?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)
          ? body.color
          : nextColor(seatCount),
      avatar:
        typeof body?.avatar === "string" && body.avatar.trim()
          ? body.avatar.trim().slice(0, 4)
          : defaultAvatar(kind),
    },
  });

  if (role === "Leader") {
    // Only one Leader at a time (Owner is separate).
    await prisma.seat.updateMany({
      where: { role: "Leader", id: { not: seat.id } },
      data: { role: "Member" },
    });
  }

  const plainCode = generateCode(kind === "agent" ? "AGENT" : "TEAM");
  await prisma.accessCode.create({
    data: { seatId: seat.id, codeHash: await hashCode(plainCode) },
  });

  return NextResponse.json(
    { seat: toSeatDTO(seat), code: plainCode },
    { status: 201 }
  );
}
