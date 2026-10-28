import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { ALLOWED_EMOJIS, MESSAGE_INCLUDE, toMessageDTO } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

/** Toggle an emoji reaction on a message. */
export async function POST(req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  const emoji = typeof body?.emoji === "string" ? body.emoji : "";
  if (!ALLOWED_EMOJIS.includes(emoji)) {
    return NextResponse.json({ error: "Emoji not allowed" }, { status: 400 });
  }
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.reaction.findUnique({
    where: { messageId_seatId_emoji: { messageId: id, seatId: seat.id, emoji } },
  });
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.reaction.create({ data: { messageId: id, seatId: seat.id, emoji } });
  }
  const fresh = await prisma.message.findUnique({
    where: { id },
    include: MESSAGE_INCLUDE,
  });
  return NextResponse.json({ message: toMessageDTO(fresh!, seat.id) });
}
