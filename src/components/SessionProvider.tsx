"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export type Me = {
  id: number;
  name: string;
  kind: string;
  role: string;
  color: string;
  avatar: string;
};

type Ctx = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionCtx = createContext<Ctx>({
  me: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function useSession() {
  return useContext(SessionCtx);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setMe(data.seat);
      } else {
        setMe(null);
      }
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loading && !me && pathname !== "/join") {
      router.push("/join");
    }
    if (!loading && me && pathname === "/join") {
      router.push("/");
    }
  }, [loading, me, pathname, router]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    router.push("/join");
  }, [router]);

  return (
    <SessionCtx.Provider value={{ me, loading, refresh, logout }}>
      {children}
    </SessionCtx.Provider>
  );
}
