"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./SessionProvider";
import { Avatar, RoleBadge, formatDay, formatTime } from "./Avatar";
import type { Channel } from "./AppShell";

type Reaction = { emoji: string; count: number; mine: boolean };
export type ChatMessage = {
  id: number;
  channelId: number;
  kind: string;
  body: string;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/channels/${channel.id}/messages`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
        setLoaded(true);
      }
    } catch {
      // retry on next poll
    }
  }, [channel.id]);

  useEffect(() => {
    setMessages([]);
    setPending([]);
    setLoaded(false);
    stickRef.current = true;
    fetchMessages();
    const t = setInterval(fetchMessages, 2000);
    return () => clearInterval(t);
  }, [fetchMessages]);

  // Auto-scroll when new content arrives and the user is near the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !me) return;
    setDraft("");
    const temp: ChatMessage = {
      id: -Date.now(),
      channelId: channel.id,
      kind: "user",
      body: text,
      pinned: false,
      editedAt: null,
      createdAt: new Date().toISOString(),
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
      setPending((p) => p.filter((m) => m.id !== temp.id));
      await fetchMessages();
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
    fetchMessages();
  };

  const togglePin = async (msg: ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, pinned: !m.pinned } : m)));
    await fetch(`/api/messages/${msg.id}/pin`, { method: "POST" }).catch(() => {});
    fetchMessages();
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
    fetchMessages();
  };

  const remove = async (msg: ChatMessage) => {
    if (!confirm("Delete this message?")) return;
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    await fetch(`/api/messages/${msg.id}`, { method: "DELETE" }).catch(() => {});
    fetchMessages();
  };

  const all = useMemo(() => [...messages, ...pending], [messages, pending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
                      <div className="msg-body text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
                        {msg.body}
                      </div>
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
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 shadow-sm transition focus-within:border-brand-500 dark:border-ink-600 dark:bg-ink-800">
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
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            className="rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-brand-600 enabled:active:scale-95 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
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
