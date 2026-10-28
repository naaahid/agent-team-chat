import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { toMessageDTO } from "@/lib/serialize";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const channelId = Number((await params).id);
  if (!Number.isFinite(channelId)) {
    return NextResponse.json({ error: "Bad channel id" }, { status: 400 });
  }
  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? 0);
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw !== null ? Number(beforeRaw) : 0;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 200);

  const include = { author: true, reactions: true } as const;
  let rows;
  if (after > 0) {
    // Newer messages after a cursor, ascending.
    rows = await prisma.message.findMany({
      where: { channelId, id: { gt: after } },
      include,
      orderBy: { id: "asc" },
      take: limit,
    });
  } else if (before > 0) {
    // The window of older messages closest to (just below) the cursor:
    // fetch descending, then reverse so the response stays ascending.
    rows = await prisma.message.findMany({
      where: { channelId, id: { lt: before } },
      include,
      orderBy: { id: "desc" },
      take: limit,
    });
    rows.reverse();
  } else {
    // No cursor: the LATEST window, returned ascending.
    rows = await prisma.message.findMany({
      where: { channelId },
      include,
      orderBy: { id: "desc" },
      take: limit,
    });
    rows.reverse();
  }
  return NextResponse.json({
    messages: rows.map((m) => toMessageDTO(m, seat.id)),
  });
}

export async function POST(req: Request, { params }: Params) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const channelId = Number((await params).id);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "Message too long (max 4000 chars)" }, { status: 400 });
  }
  const message = await prisma.message.create({
    data: { channelId, authorId: seat.id, body: text, kind: "user" },
    include: { author: true, reactions: true },
  });
  return NextResponse.json({ message: toMessageDTO(message, seat.id) }, { status: 201 });
}
