import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/guard";
import { postSystemMessage } from "@/lib/init";

type Params = { params: Promise<{ seatId: string }> };

/**
 * Owner-only seat management.
 * Body: { action: "make_leader" | "remove_leader" | "revoke_sessions" | "remove_member" }
 */
export async function POST(req: Request, { params }: Params) {
  const { seat: me, error } = await requireOwner();
  if (error) return error;
  const seatId = Number((await params).seatId);
  const seat = await prisma.seat.findUnique({ where: { id: seatId } });
  if (!seat) return NextResponse.json({ error: "Seat not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "make_leader") {
    if (seat.role === "Owner") {
      return NextResponse.json({ error: "The Owner is already in charge" }, { status: 400 });
    }
    await prisma.seat.updateMany({ where: { role: "Leader" }, data: { role: "Member" } });
    await prisma.seat.update({ where: { id: seatId }, data: { role: "Leader" } });
    await postSystemMessage("general", `👑 ${seat.name} is now the team Leader.`);
    return NextResponse.json({ ok: true });
  }

  if (action === "remove_leader") {
    if (seat.role === "Leader") {
      await prisma.seat.update({ where: { id: seatId }, data: { role: "Member" } });
      await postSystemMessage("general", `${seat.name} is no longer the team Leader.`);
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "revoke_sessions") {
    await prisma.session.updateMany({
      where: { seatId, revoked: false },
      data: { revoked: true },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove_member") {
    if (seat.id === me.id) {
      return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
    }
    if (seat.role === "Owner") {
      return NextResponse.json({ error: "Cannot remove the Owner" }, { status: 400 });
    }
    await prisma.seat.delete({ where: { id: seatId } });
    await postSystemMessage("general", `${seat.name} was removed from the team.`);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
