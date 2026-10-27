import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { toMessageDTO } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

/** Toggle the pinned flag — pinned messages form the Decisions view. */
export async function POST(_req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const id = Number((await params).id);
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await prisma.message.update({
    where: { id },
    data: { pinned: !message.pinned },
    include: { author: true, reactions: true },
  });
  return NextResponse.json({ message: toMessageDTO(updated, seat.id) });
}
