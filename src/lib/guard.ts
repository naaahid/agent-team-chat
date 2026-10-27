import { NextResponse } from "next/server";
import type { Seat } from "@prisma/client";
import { getCurrentSeat } from "./auth";

export async function requireSeat(): Promise<
  { seat: Seat; error: null } | { seat: null; error: NextResponse }
> {
  const seat = await getCurrentSeat();
  if (!seat) {
    return {
      seat: null,
      error: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  return { seat, error: null };
}

export async function requireOwner(): Promise<
  { seat: Seat; error: null } | { seat: null; error: NextResponse }
> {
  const { seat, error } = await requireSeat();
  if (error) return { seat: null, error };
  if (seat!.role !== "Owner") {
    return {
      seat: null,
      error: NextResponse.json({ error: "Owner only" }, { status: 403 }),
    };
  }
  return { seat, error: null };
}
