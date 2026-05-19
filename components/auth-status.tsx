"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function AuthStatus() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase?.auth.signOut();
    window.location.href = "/auth";
  }

  if (loading) {
    return <div className="hidden h-10 w-28 rounded-full bg-white/70 shadow-sm sm:block" />;
  }

  if (!user) {
    return (
      <Link
        href="/auth"
        className="hidden items-center gap-2 rounded-full bg-[#171b24] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(20,25,34,0.16)] transition hover:-translate-y-0.5 hover:bg-[#262c37] sm:flex"
      >
        <UserRound size={16} />
        Sign in
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="hidden items-center gap-2 rounded-full bg-[#171b24] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(20,25,34,0.16)] transition hover:-translate-y-0.5 hover:bg-[#262c37] sm:flex"
      title={user.email ?? "Signed in"}
    >
      <LogOut size={16} />
      Sign out
    </button>
  );
}
