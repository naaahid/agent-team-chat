import type { Attachment, Message, Reaction, Seat } from "@prisma/client";

/** Attachment metadata as sent to clients — never the file bytes. */
export type AttachmentDTO = {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
};

export type MessageDTO = {
  id: number;
  channelId: number;
  kind: string;
  body: string;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  attachment: AttachmentDTO | null;
  author: {
    id: number;
    name: string;
    kind: string;
    role: string;
    color: string;
    avatar: string;
  } | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
};

type AttachmentMeta = Pick<Attachment, "id" | "filename" | "mimeType" | "size">;

type MessageWithRels = Message & {
  author: Seat | null;
  reactions: Reaction[];
  attachment: AttachmentMeta | null;
};

/**
 * The include every message query must use so DTOs always carry the
 * attachment metadata. `select` keeps the file bytes out of list queries —
 * bytes are only ever loaded by GET /api/attachments/[id].
 */
export const MESSAGE_INCLUDE = {
  author: true,
  reactions: true,
  attachment: { select: { id: true, filename: true, mimeType: true, size: true } },
} as const;

const EMOJI_ORDER = ["👍", "❤️", "🔥", "😂", "👀"];
export const ALLOWED_EMOJIS = EMOJI_ORDER;

export function toMessageDTO(msg: MessageWithRels, currentSeatId: number): MessageDTO {
  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of msg.reactions) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
    g.count += 1;
    if (r.seatId === currentSeatId) g.mine = true;
    grouped.set(r.emoji, g);
  }
  const reactions = EMOJI_ORDER.filter((e) => grouped.has(e)).map((e) => ({
    emoji: e,
    count: grouped.get(e)!.count,
    mine: grouped.get(e)!.mine,
  }));
  return {
    id: msg.id,
    channelId: msg.channelId,
    kind: msg.kind,
    body: msg.body,
    pinned: msg.pinned,
    editedAt: msg.editedAt?.toISOString() ?? null,
    createdAt: msg.createdAt.toISOString(),
    attachment: msg.attachment
      ? {
          id: msg.attachment.id,
          filename: msg.attachment.filename,
          mimeType: msg.attachment.mimeType,
          size: msg.attachment.size,
        }
      : null,
    author: msg.author
      ? {
          id: msg.author.id,
          name: msg.author.name,
          kind: msg.author.kind,
          role: msg.author.role,
          color: msg.author.color,
          avatar: msg.author.avatar,
        }
      : null,
    reactions,
  };
}
