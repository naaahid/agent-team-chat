"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./SessionProvider";
import { Avatar, RoleBadge, formatDay, formatTime } from "./Avatar";
import type { Channel } from "./AppShell";

type Reaction = { emoji: string; count: number; mine: boolean };
export type ChatAttachment = {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
};
export type ChatMessage = {
  id: number;
  channelId: number;
  kind: string;
  body: string;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  attachment: ChatAttachment | null;
  author: {
    id: number;
    name: string;
    kind: string;
    role: string;
    color: string;
    avatar: string;
  } | null;
  reactions: Reaction[];
};

const EMOJIS = ["👍", "❤️", "🔥", "😂", "👀"];

// Attachments: one file per message, 3 MB max (enforced here and on the
// server — files travel base64-encoded inside the JSON request body).
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const ACCEPT_TYPES = "image/*,.pdf,.txt,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// History page size: opening a channel loads the latest PAGE_SIZE messages;
// scrolling to the top auto-loads the previous window of the same size.
const PAGE_SIZE = 100;

// useLayoutEffect that falls back to useEffect during SSR.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function sameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function ChatView({ channel }: { channel: Channel }) {
  const { me } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [staged, setStaged] = useState<{ file: File; previewUrl: string | null } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  const hasOlderRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const restoreRef = useRef<{ prevHeight: number } | null>(null);
  const activeChannelRef = useRef(channel.id);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const clearStaged = useCallback(() => {
    setStaged((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  // Stage a file picked / pasted / dropped for the next message.
  const stageFile = useCallback(
    (file: File) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setFileError("File ta 3MB er beshi — pathano jabe na");
        return;
      }
      setFileError(null);
      setStaged((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        };
      });
    },
    []
  );

  // Merge fetched messages into state by id (incoming wins), ascending, no dupes.
  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const byId = new Map<number, ChatMessage>();
      for (const m of prev) byId.set(m.id, m);
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  }, []);

  // Initial load: the API's default page is the LATEST window.
  const loadInitial = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channel.id}/messages?limit=${PAGE_SIZE}`, {
        cache: "no-store",
      });
      if (res.ok && activeChannelRef.current === channel.id) {
        const data = await res.json();
        setMessages(data.messages);
        hasOlderRef.current = data.messages.length >= PAGE_SIZE;
        setLoaded(true);
      }
    } catch {
      // retry on next poll
    }
  }, [channel.id]);

  // Live polling: only messages newer than the newest one already loaded,
  // appended via the id merge. While nothing is loaded yet, fall back to
  // the latest-window fetch so an empty channel picks up its first message.
  const pollNew = useCallback(async () => {
    const current = messagesRef.current;
    const newest = current.length ? current[current.length - 1].id : 0;
    try {
      const url =
        newest > 0
          ? `/api/channels/${channel.id}/messages?after=${newest}`
          : `/api/channels/${channel.id}/messages?limit=${PAGE_SIZE}`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok && activeChannelRef.current === channel.id) {
        const data = await res.json();
        if (data.messages.length) {
          if (newest > 0) {
            mergeMessages(data.messages);
          } else {
            setMessages(data.messages);
            hasOlderRef.current = data.messages.length >= PAGE_SIZE;
          }
          setLoaded(true);
        }
      }
    } catch {
      // retry on next poll
    }
  }, [channel.id, mergeMessages]);

  // After a local mutation (react / pin / edit / delete), resync the newest
  // window and merge it in, so counts and edits refresh without discarding
  // older history the user has scrolled up through.
  const refreshLatest = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channel.id}/messages?limit=200`, {
        cache: "no-store",
      });
      if (res.ok && activeChannelRef.current === channel.id) {
        const data = await res.json();
        mergeMessages(data.messages);
      }
    } catch {
      // optimistic state already applied
    }
  }, [channel.id, mergeMessages]);

  // Infinite scroll up: fetch the window just older than the oldest loaded
  // message, prepend it via the merge, and remember the scroll height so
  // the layout effect can restore the exact reading position (no jump).
  const loadOlder = useCallback(async () => {
    const el = scrollRef.current;
    const current = messagesRef.current;
    if (!el || loadingOlderRef.current || !hasOlderRef.current || current.length === 0) return;
    const oldest = current[0].id;
    if (oldest <= 0) return;
    loadingOlderRef.current = true;
    try {
      const res = await fetch(
        `/api/channels/${channel.id}/messages?before=${oldest}&limit=${PAGE_SIZE}`,
        { cache: "no-store" }
      );
      if (res.ok && activeChannelRef.current === channel.id) {
        const data = await res.json();
        const older: ChatMessage[] = data.messages;
        hasOlderRef.current = older.length >= PAGE_SIZE;
        if (older.length > 0) {
          restoreRef.current = { prevHeight: el.scrollHeight };
          mergeMessages(older);
        }
      }
    } catch {
      // a later scroll near the top can retry
    } finally {
      loadingOlderRef.current = false;
    }
  }, [channel.id, mergeMessages]);

  useEffect(() => {
    activeChannelRef.current = channel.id;
    setMessages([]);
    setPending([]);
    setLoaded(false);
    setEditingId(null);
    clearStaged();
    setFileError(null);
    setDragOver(false);
    stickRef.current = true;
    hasOlderRef.current = false;
    loadingOlderRef.current = false;
    restoreRef.current = null;
    loadInitial();
    const t = setInterval(pollNew, 2000);
    return () => clearInterval(t);
  }, [loadInitial, pollNew, clearStaged]);

  // Scroll management: after a history prepend, shift scrollTop by the
  // height delta so the visible messages do not move; otherwise keep the
  // view pinned to the bottom while the user is already near it (and never
  // yank them down while they are scrolled up reading history).
  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreRef.current) {
      const delta = el.scrollHeight - restoreRef.current.prevHeight;
      restoreRef.current = null;
      if (delta !== 0) el.scrollTop = el.scrollTop + delta;
      return;
    }
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 100) {
      void loadOlder();
    }
  };

  const send = async () => {
    const text = draft.trim();
    if ((!text && !staged) || !me || sendingFile) return;
    const fileToSend = staged?.file ?? null;
    setDraft("");
    stickRef.current = true;

    // Attachment path: the server assigns the attachment id, so there is no
    // optimistic bubble — send body + file together, then merge the
    // returned message like a resync.
    if (fileToSend) {
      setSendingFile(true);
      try {
        const dataBase64 = await readAsBase64(fileToSend);
        const res = await fetch(`/api/channels/${channel.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: text,
            attachment: {
              filename: fileToSend.name || "file",
              mimeType: fileToSend.type || "application/octet-stream",
              dataBase64,
            },
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(typeof errData?.error === "string" ? errData.error : "send failed");
        }
        const data = await res.json().catch(() => null);
        clearStaged();
        if (data?.message) mergeMessages([data.message]);
      } catch (err) {
        // Keep the staged file and restore the text so the user can retry.
        setDraft(text);
        setFileError(err instanceof Error && err.message !== "send failed" ? err.message : "File ta pathano jay ni — abar try koro");
      } finally {
        setSendingFile(false);
      }
      return;
    }

    const temp: ChatMessage = {
      id: -Date.now(),
      channelId: channel.id,
      kind: "user",
      body: text,
      pinned: false,
      editedAt: null,
      createdAt: new Date().toISOString(),
      attachment: null,
      author: { id: me.id, name: me.name, kind: me.kind, role: me.role, color: me.color, avatar: me.avatar },
      reactions: [],
    };
    setPending((p) => [...p, temp]);
    stickRef.current = true;
    try {
      const res = await fetch(`/api/channels/${channel.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error("send failed");
      const data = await res.json().catch(() => null);
      setPending((p) => p.filter((m) => m.id !== temp.id));
      if (data?.message) mergeMessages([data.message]);
    } catch {
      setPending((p) =>
        p.map((m) => (m.id === temp.id ? { ...m, body: m.body + "  ⚠️ (failed to send — check connection)" } : m))
      );
    }
  };

  const react = async (msg: ChatMessage, emoji: string) => {
    // Optimistic toggle
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msg.id) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        let reactions: Reaction[];
        if (existing?.mine) {
          reactions = m.reactions
            .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r))
            .filter((r) => r.count > 0);
        } else if (existing) {
          reactions = m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
        } else {
          reactions = [...m.reactions, { emoji, count: 1, mine: true }];
        }
        return { ...m, reactions };
      })
    );
    await fetch(`/api/messages/${msg.id}/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    }).catch(() => {});
    refreshLatest();
  };

  const togglePin = async (msg: ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, pinned: !m.pinned } : m)));
    await fetch(`/api/messages/${msg.id}/pin`, { method: "POST" }).catch(() => {});
    refreshLatest();
  };

  const saveEdit = async (msg: ChatMessage) => {
    const text = editText.trim();
    if (!text) return;
    setEditingId(null);
    await fetch(`/api/messages/${msg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    }).catch(() => {});
    refreshLatest();
  };

  const remove = async (msg: ChatMessage) => {
    if (!confirm("Delete this message?")) return;
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    await fetch(`/api/messages/${msg.id}`, { method: "DELETE" }).catch(() => {});
    refreshLatest();
  };

  const all = useMemo(() => [...messages, ...pending], [messages, pending]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) stageFile(f);
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-brand-500/10">
          <span className="rounded-xl bg-white px-4 py-2 text-sm font-semibold shadow-lg dark:bg-ink-800">
            📎 Drop korlei file attach hobe
          </span>
        </div>
      )}
      {/* Channel header */}
      <div className="border-b border-slate-200 px-4 py-3 dark:border-ink-700">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-bold">#{channel.name}</h1>
          {channel.slug === "decisions" && (
            <span className="rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-500">DECISIONS LOG</span>
          )}
        </div>
        {channel.topic && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{channel.topic}</p>}
      </div>

      {/* Feed */}
      <div ref={scrollRef} onScroll={onScroll} className="nice-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!loaded && <div className="animate-pulse py-10 text-center text-sm text-slate-400">Loading messages…</div>}
        {loaded && all.length === 0 && (
          <div className="mx-auto max-w-sm py-16 text-center">
            <div className="text-4xl">🌱</div>
            <p className="mt-3 font-semibold">This channel is quiet… for now</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Be the first to post in #{channel.name}. Ideas, plans, jokes — all welcome.
            </p>
          </div>
        )}
        {all.map((msg, i) => {
          const prev = all[i - 1];
          const showDay = !prev || !sameDay(prev.createdAt, msg.createdAt);
          if (msg.kind === "system") {
            return (
              <React.Fragment key={msg.id}>
                {showDay && <DayDivider iso={msg.createdAt} />}
                <div className="animate-msg-in py-1 text-center text-xs text-slate-400 dark:text-slate-500">
                  {msg.body} · {formatTime(msg.createdAt)}
                </div>
              </React.Fragment>
            );
          }
          const mine = msg.author?.id === me?.id;
          const canModify = mine || me?.role === "Owner";
          return (
            <React.Fragment key={msg.id}>
              {showDay && <DayDivider iso={msg.createdAt} />}
              <div
                className="group animate-msg-in relative -mx-2 rounded-xl px-2 py-1.5 transition hover:bg-slate-100 dark:hover:bg-ink-850"
                onMouseEnter={() => setHoverId(msg.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                <div className="flex gap-3">
                  <Avatar
                    name={msg.author?.name ?? "?"}
                    color={msg.author?.color ?? "#888"}
                    avatar={msg.author?.avatar ?? "❔"}
                    size={38}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-bold" style={{ color: msg.author?.color }}>
                        {msg.author?.name ?? "Unknown"}
                      </span>
                      {msg.author && <RoleBadge role={msg.author.role} kind={msg.author.kind} />}
                      <span className="text-[11px] text-slate-400">{formatTime(msg.createdAt)}</span>
                      {msg.pinned && <span title="Pinned to Decisions">📌</span>}
                      {msg.editedAt && <span className="text-[11px] text-slate-400">(edited)</span>}
                    </div>

                    {editingId === msg.id ? (
                      <div className="mt-1">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={2}
                          autoFocus
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-600 dark:bg-ink-800"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              saveEdit(msg);
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <div className="mt-1 flex gap-2 text-xs">
                          <button onClick={() => saveEdit(msg)} className="font-semibold text-brand-500 hover:underline">
                            Save
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-slate-500 hover:underline">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.body && (
                          <div className="msg-body text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
                            {msg.body}
                          </div>
                        )}
                        {msg.attachment && <MessageAttachment attachment={msg.attachment} />}
                      </>
                    )}

                    {msg.reactions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {msg.reactions.map((r) => (
                          <button
                            key={r.emoji}
                            onClick={() => react(msg, r.emoji)}
                            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                              r.mine
                                ? "border-brand-500 bg-brand-500/15 font-semibold"
                                : "border-slate-300 hover:border-slate-400 dark:border-ink-600 dark:hover:border-ink-600/60"
                            }`}
                          >
                            <span>{r.emoji}</span> {r.count}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Hover actions */}
                {hoverId === msg.id && editingId !== msg.id && (
                  <div className="absolute -top-3 right-2 flex animate-fade-in items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1 py-0.5 shadow-md dark:border-ink-600 dark:bg-ink-800">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        onClick={() => react(msg, e)}
                        className="rounded px-1 py-0.5 text-sm transition hover:scale-125"
                        title={`React ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                    <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-ink-600" />
                    <button
                      onClick={() => togglePin(msg)}
                      className="rounded px-1.5 py-0.5 text-xs transition hover:bg-slate-100 dark:hover:bg-ink-700"
                      title={msg.pinned ? "Unpin" : "Pin to Decisions"}
                    >
                      📌
                    </button>
                    {canModify && (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(msg.id);
                            setEditText(msg.body);
                          }}
                          className="rounded px-1.5 py-0.5 text-xs transition hover:bg-slate-100 dark:hover:bg-ink-700"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => remove(msg)}
                          className="rounded px-1.5 py-0.5 text-xs transition hover:bg-slate-100 dark:hover:bg-ink-700"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 p-3 dark:border-ink-700">
        {fileError && <div className="mb-2 px-1 text-xs font-medium text-red-500">{fileError}</div>}
        {staged && (
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-ink-600 dark:bg-ink-850">
            {staged.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={staged.previewUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
            ) : (
              <span className="text-xl">📄</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{staged.file.name || "file"}</span>
              <span className="block text-xs text-slate-400">{formatSize(staged.file.size)}</span>
            </span>
            {sendingFile && <span className="text-xs text-slate-400">Pathano hocche…</span>}
            <button
              onClick={clearStaged}
              disabled={sendingFile}
              className="rounded-lg px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-ink-700"
              title="Remove attachment"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 shadow-sm transition focus-within:border-brand-500 dark:border-ink-600 dark:bg-ink-800">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_TYPES}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) stageFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg px-1.5 py-1 text-lg transition hover:bg-slate-100 dark:hover:bg-ink-700"
            title="Attach a picture or document (max 3 MB)"
          >
            📎
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder={`Message #${channel.name} — Enter to send, Shift+Enter for a new line`}
            className="max-h-36 min-h-[24px] flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-slate-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of items) {
                if (item.kind === "file") {
                  const f = item.getAsFile();
                  if (f) {
                    e.preventDefault();
                    stageFile(f);
                    break;
                  }
                }
              }
            }}
          />
          <button
            onClick={send}
            disabled={(!draft.trim() && !staged) || sendingFile}
            className="rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-brand-600 enabled:active:scale-95 disabled:opacity-40"
          >
            {sendingFile ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageAttachment({ attachment }: { attachment: ChatAttachment }) {
  const url = `/api/attachments/${attachment.id}`;
  if (attachment.mimeType.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={attachment.filename}
          className="max-h-80 max-w-[320px] rounded-xl border border-slate-200 object-contain dark:border-ink-600"
          loading="lazy"
        />
      </a>
    );
  }
  return (
    <a
      href={url}
      className="mt-1.5 flex w-fit max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-slate-300 hover:bg-slate-100 dark:border-ink-600 dark:bg-ink-850 dark:hover:bg-ink-800"
    >
      <span className="text-2xl">📄</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{attachment.filename}</span>
        <span className="block text-xs text-slate-400">{formatSize(attachment.size)} · download</span>
      </span>
    </a>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-200 dark:bg-ink-700" />
      <span className="rounded-full border border-slate-200 bg-white px-3 py-0.5 text-[11px] font-semibold text-slate-500 dark:border-ink-700 dark:bg-ink-850 dark:text-slate-400">
        {formatDay(iso)}
      </span>
      <div className="h-px flex-1 bg-slate-200 dark:bg-ink-700" />
    </div>
  );
}
