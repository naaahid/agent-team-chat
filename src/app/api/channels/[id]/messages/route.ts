import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeat } from "@/lib/guard";
import { MESSAGE_INCLUDE, toMessageDTO } from "@/lib/serialize";

/** Raw file cap: uploads arrive base64-encoded in JSON, so 3 MB of file
 *  stays safely under the platform's ~4.5 MB request-body limit. */
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/** Reduce a client-supplied name to a safe basename for storage/display. */
function sanitizeFilename(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  // Strip path separators, quotes and control characters.
  return base.replace(/["\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
}

type ParsedAttachment = { filename: string; mimeType: string; data: Uint8Array<ArrayBuffer> };

function parseAttachment(raw: unknown): { attachment: ParsedAttachment | null; error: NextResponse | null } {
  if (raw === undefined || raw === null) return { attachment: null, error: null };
  if (typeof raw !== "object") {
    return { attachment: null, error: NextResponse.json({ error: "Bad attachment" }, { status: 400 }) };
  }
  const att = raw as { filename?: unknown; mimeType?: unknown; dataBase64?: unknown };
  const filename = sanitizeFilename(att.filename);
  if (!filename) {
    return {
      attachment: null,
      error: NextResponse.json({ error: "Attachment filename is missing" }, { status: 400 }),
    };
  }
  if (typeof att.dataBase64 !== "string" || att.dataBase64.length === 0) {
    return {
      attachment: null,
      error: NextResponse.json({ error: "Attachment data is missing" }, { status: 400 }),
    };
  }
  const b64 = att.dataBase64.replace(/\s+/g, "");
  // Cheap early reject before decoding: base64 inflates size by ~4/3.
  if (b64.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    return {
      attachment: null,
      error: NextResponse.json(
        { error: `File is too large or not valid base64 (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB)` },
        { status: 413 }
      ),
    };
  }
  // Decode into a fresh Uint8Array (Prisma's Bytes input type).
  let data: Uint8Array<ArrayBuffer>;
  try {
    data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return {
      attachment: null,
      error: NextResponse.json({ error: "Attachment data is not valid base64" }, { status: 400 }),
    };
  }
  if (data.length === 0) {
    return {
      attachment: null,
      error: NextResponse.json({ error: "Attachment is empty" }, { status: 400 }),
    };
  }
  if (data.length > MAX_ATTACHMENT_BYTES) {
    return {
      attachment: null,
      error: NextResponse.json(
        { error: `File too large (max ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB)` },
        { status: 413 }
      ),
    };
  }
  const mimeType =
    typeof att.mimeType === "string" && att.mimeType.trim()
      ? att.mimeType.trim().slice(0, 120)
      : "application/octet-stream";
  return { attachment: { filename, mimeType, data }, error: null };
}

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

  const include = MESSAGE_INCLUDE;
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
  const { attachment, error: attachmentError } = parseAttachment(body?.attachment);
  if (attachmentError) return attachmentError;
  // A message needs some content: text, an attachment, or both.
  if (!text && !attachment) {
    return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "Message too long (max 4000 chars)" }, { status: 400 });
  }
  const message = await prisma.message.create({
    data: {
      channelId,
      authorId: seat.id,
      body: text,
      kind: "user",
      ...(attachment
        ? {
            attachment: {
              create: {
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.data.length,
                data: attachment.data,
              },
            },
          }
        : {}),
    },
    include: MESSAGE_INCLUDE,
  });
  return NextResponse.json({ message: toMessageDTO(message, seat.id) }, { status: 201 });
}
