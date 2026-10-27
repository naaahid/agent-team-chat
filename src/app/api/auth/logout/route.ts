import { NextResponse } from "next/server";
import { clearSessionCookie, revokeCurrentSession } from "@/lib/auth";

export async function POST() {
  await revokeCurrentSession();
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
