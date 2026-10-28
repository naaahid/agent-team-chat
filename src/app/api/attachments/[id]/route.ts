import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";

type Params = { params: Promise<{ id: string }> };

/**
 * Stream a stored attachment's bytes to a signed-in member. Images and PDFs
 * are shown inline (chat previews, click-to-open); everything else is a
 * download. This is the ONLY route that loads the file bytes — message list
 * responses carry metadata only.
 */
export async function GET(_req: Request, { params }: Params) {
  const { error } = await requireSeat();
  if (error) return error;
  const id = Number((await params).id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Bad attachment id" }, { status: 400 });
  }
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const inline =
    attachment.mimeType.startsWith("image/") || attachment.mimeType === "application/pdf";
  // ASCII-safe fallback for legacy clients + RFC 5987 encoded real name.
  const fallback = attachment.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_") || "file";
  const headers = new Headers();
  headers.set("Content-Type", attachment.mimeType || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`
  );
  headers.set("Content-Length", String(attachment.size));
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new NextResponse(Uint8Array.from(attachment.data), { status: 200, headers });
}
