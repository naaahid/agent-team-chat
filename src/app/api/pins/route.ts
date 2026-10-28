import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { MESSAGE_INCLUDE, toMessageDTO } from "@/lib/serialize";

/** All pinned messages across channels = the Decisions view. */
export async function GET() {
  const { seat, error } = await requireSeat();
  if (error) return error;
  const messages = await prisma.message.findMany({
    where: { pinned: true },
    include: { ...MESSAGE_INCLUDE, channel: true },
    orderBy: { id: "desc" },
  });
  return NextResponse.json({
    pins: messages.map((m) => ({
      ...toMessageDTO(m, seat.id),
      channelSlug: m.channel.slug,
    })),
  });
}
