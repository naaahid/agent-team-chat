import { NextResponse } from "next/server";
import { getCurrentSeat, toSeatDTO } from "@/lib/auth";
import { ensureSeed } from "@/lib/init";

export async function GET() {
  await ensureSeed();
  const seat = await getCurrentSeat();
  if (!seat) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json({ seat: toSeatDTO(seat) });
}
