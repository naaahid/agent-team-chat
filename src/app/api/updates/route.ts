import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";

export async function GET() {
  const { error } = await requireSeat();
  if (error) return error;
  const updates = await prisma.dailyUpdate.findMany({
    include: { author: true },
    orderBy: { id: "desc" },
    take: 200,
  });
  return NextResponse.json({
    updates: updates.map((u) => ({
      id: u.id,
      body: u.body,
      createdAt: u.createdAt.toISOString(),
      author: u.author
        ? { id: u.author.id, name: u.author.name, color: u.author.color, avatar: u.author.avatar, kind: u.author.kind }
        : null,
    })),
  });
}

export async function POST(req: Request) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Update is empty" }, { status: 400 });
  const update = await prisma.dailyUpdate.create({
    data: { authorId: seat.id, body: text.slice(0, 8000) },
    include: { author: true },
  });
  return NextResponse.json(
    {
      update: {
        id: update.id,
        body: update.body,
        createdAt: update.createdAt.toISOString(),
        author: update.author
          ? { id: update.author.id, name: update.author.name, color: update.author.color, avatar: update.author.avatar, kind: update.author.kind }
          : null,
      },
    },
    { status: 201 }
  );
}
