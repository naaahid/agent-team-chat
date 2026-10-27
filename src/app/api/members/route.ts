import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { toSeatDTO } from "@/lib/auth";

export async function GET() {
  const { error } = await requireSeat();
  if (error) return error;
  const seats = await prisma.seat.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json({ members: seats.map(toSeatDTO) });
}
