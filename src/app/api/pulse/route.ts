import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Always computed fresh — this endpoint is a live activity counter.
export const dynamic = "force-dynamic";

/**
 * Public activity pulse for external watchers (no login needed).
 * Returns ONLY counters — never message bodies, authors, or names —
 * so a watcher can cheaply detect "something changed" and only then
 * do a full read. Shape:
 *   { latestMessageId, channels: { "<channelId>": <maxMessageId> }, latestMemberId }
 */
export async function GET() {
  const [latestMessage, perChannel, channelRows, latestMember] = await Promise.all([
    prisma.message.aggregate({ _max: { id: true } }),
    prisma.message.groupBy({
      by: ["channelId"],
      _max: { id: true },
    }),
    prisma.channel.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    prisma.seat.aggregate({ _max: { id: true } }),
  ]);

  const channels: Record<string, number> = {};
  for (const row of channelRows) channels[String(row.id)] = 0;
  for (const row of perChannel) {
    if (row._max.id != null) channels[String(row.channelId)] = row._max.id;
  }

  return NextResponse.json(
    {
      latestMessageId: latestMessage._max.id ?? 0,
      channels,
      latestMemberId: latestMember._max.id ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
