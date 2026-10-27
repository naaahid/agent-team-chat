import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";

export async function GET() {
  const { error } = await requireSeat();
  if (error) return error;
  const channels = await prisma.channel.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json({ channels });
}

/** Owner-only: add a channel. */
export async function POST(req: Request) {
  const { seat, error } = await requireSeat();
  if (error) return error;
  if (seat.role !== "Owner") {
    return NextResponse.json({ error: "Only the Owner can add channels" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const rawName = typeof body?.name === "string" ? body.name : "";
  const slug = rawName
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    return NextResponse.json({ error: "Channel name is required" }, { status: 400 });
  }
  const existing = await prisma.channel.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json({ error: "That channel already exists" }, { status: 409 });
  }
  const channel = await prisma.channel.create({
    data: {
      slug,
      name: slug,
      topic: typeof body?.topic === "string" ? body.topic.slice(0, 200) : "",
      createdBy: seat.id,
    },
  });
  await prisma.message.create({
    data: {
      channelId: channel.id,
      kind: "system",
      body: `#${slug} created by ${seat.name}.`,
    },
  });
  return NextResponse.json({ channel }, { status: 201 });
}
