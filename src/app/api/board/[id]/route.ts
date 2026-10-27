import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { BOARD_COLUMNS } from "@/lib/board";

type Params = { params: Promise<{ id: string }> };

/** Move a card to another column and/or edit its text. Any member may move. */
export async function PATCH(req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const id = Number((await params).id);
  const card = await prisma.boardCard.findUnique({ where: { id } });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: { column?: string; title?: string; description?: string; position?: number } = {};
  if (typeof body?.column === "string" && BOARD_COLUMNS.includes(body.column as never)) {
    data.column = body.column;
    const count = await prisma.boardCard.count({ where: { column: body.column } });
    data.position = count;
  }
  if (typeof body?.title === "string" && body.title.trim()) {
    data.title = body.title.trim().slice(0, 200);
  }
  if (typeof body?.description === "string") {
    data.description = body.description.trim().slice(0, 1000);
  }
  const updated = await prisma.boardCard.update({
    where: { id },
    data,
    include: { proposedBy: true },
  });
  void seat;
  return NextResponse.json({
    card: {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      column: updated.column,
      position: updated.position,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      proposedBy: updated.proposedBy
        ? { id: updated.proposedBy.id, name: updated.proposedBy.name, color: updated.proposedBy.color, avatar: updated.proposedBy.avatar }
        : null,
    },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const id = Number((await params).id);
  const card = await prisma.boardCard.findUnique({ where: { id } });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (card.proposedById !== seat.id && seat.role !== "Owner") {
    return NextResponse.json({ error: "Only the proposer or the Owner can delete a card" }, { status: 403 });
  }
  await prisma.boardCard.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
