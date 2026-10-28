import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { MESSAGE_INCLUDE, toMessageDTO } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

async function loadOwned(id: number, seatId: number, isOwner: boolean) {
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return { message: null, forbidden: false };
  const canTouch = message.authorId === seatId || isOwner;
  return { message, forbidden: !canTouch };
}

/** Edit own message (Owner may edit any). */
export async function PATCH(req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const id = Number((await params).id);
  const { message, forbidden } = await loadOwned(id, seat.id, seat.role === "Owner");
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (forbidden || message.kind === "system") {
    return NextResponse.json({ error: "You can only edit your own messages" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  const updated = await prisma.message.update({
    where: { id },
    data: { body: text.slice(0, 4000), editedAt: new Date() },
    include: MESSAGE_INCLUDE,
  });
  return NextResponse.json({ message: toMessageDTO(updated, seat.id) });
}

/** Delete own message (Owner may delete any). */
export async function DELETE(_req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const id = Number((await params).id);
  const { message, forbidden } = await loadOwned(id, seat.id, seat.role === "Owner");
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (forbidden || message.kind === "system") {
    return NextResponse.json({ error: "You can only delete your own messages" }, { status: 403 });
  }
  await prisma.message.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
