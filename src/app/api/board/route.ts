import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { isBoardColumn } from "@/lib/board";

export async function GET() {
  const { error } = await requireSeat();
  if (error) return error;
  const cards = await prisma.boardCard.findMany({
    include: { proposedBy: true },
    orderBy: [{ column: "asc" }, { position: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({
    cards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      column: c.column,
      position: c.position,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      proposedBy: c.proposedBy
        ? { id: c.proposedBy.id, name: c.proposedBy.name, color: c.proposedBy.color, avatar: c.proposedBy.avatar }
        : null,
    })),
  });
}

export async function POST(req: Request) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const column = isBoardColumn(body?.column) ? body.column : "idea";
  if (!title) return NextResponse.json({ error: "Card title is required" }, { status: 400 });
  const count = await prisma.boardCard.count({ where: { column } });
  const card = await prisma.boardCard.create({
    data: {
      title: title.slice(0, 200),
      description: description.slice(0, 1000),
      column,
      position: count,
      proposedById: seat.id,
    },
    include: { proposedBy: true },
  });
  return NextResponse.json(
    {
      card: {
        id: card.id,
        title: card.title,
        description: card.description,
        column: card.column,
        position: card.position,
        createdAt: card.createdAt.toISOString(),
        updatedAt: card.updatedAt.toISOString(),
        proposedBy: card.proposedBy
          ? { id: card.proposedBy.id, name: card.proposedBy.name, color: card.proposedBy.color, avatar: card.proposedBy.avatar }
          : null,
      },
    },
    { status: 201 }
  );
}
