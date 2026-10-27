import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/guard";
import { toSeatDTO } from "@/lib/auth";

/** Owner-only: every seat, its code status and its live sessions. */
export async function GET() {
  const { error } = await requireOwner();
  if (error) return error;
  const seats = await prisma.seat.findMany({
    orderBy: { id: "asc" },
    include: {
      code: true,
      sessions: { where: { revoked: false, expiresAt: { gt: new Date() } } },
    },
  });
  return NextResponse.json({
    seats: seats.map((s) => ({
      ...toSeatDTO(s),
      code: s.code
        ? {
            id: s.code.id,
            revoked: s.code.revoked,
            createdAt: s.code.createdAt.toISOString(),
            lastUsedAt: s.code.lastUsedAt?.toISOString() ?? null,
          }
        : null,
      activeSessions: s.sessions.length,
    })),
  });
}
