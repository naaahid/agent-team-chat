"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell, type Channel } from "@/components/AppShell";
import { ChatView } from "@/components/ChatView";
import { useSession } from "@/components/SessionProvider";

function ChatHome() {
  const { me } = useSession();
  const [channels, setChannels] = useState<Channel[]>([]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedId = Number(searchParams.get("ch") ?? 0);

  useEffect(() => {
    if (!me) return;
    fetch("/api/channels", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d) => setChannels(d.channels))
      .catch(() => {});
  }, [me]);

  const active =
    channels.find((c) => c.id === requestedId) ??
    channels.find((c) => c.slug === "general") ??
    channels[0];

  useEffect(() => {
    if (active && requestedId !== active.id) {
      router.replace(`/?ch=${active.id}`);
    }
  }, [active, requestedId, router]);

  return (
    <AppShell>
      {active ? (
        <ChatView key={active.id} channel={active} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="animate-pulse text-sm text-slate-400">Opening the team room…</div>
        </div>
      )}
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-slate-400">
          Loading…
        </div>
      }
    >
      <ChatHome />
    </Suspense>
  );
}
