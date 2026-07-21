"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function OwnerPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createBrowserSupabaseClient();

    if (!supabase) {
      setLoading(false);
      setError("Owner sign-in is not configured.");
      return;
    }

    const result = await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setLoading(false);
      setError("Those owner credentials could not be verified.");
      return;
    }

    const accessResponse = await fetch("/api/owner/access", {
      method: "GET",
      cache: "no-store"
    });

    if (!accessResponse.ok) {
      await supabase.auth.signOut();
      setLoading(false);
      setError("This account is not on the Stealth owner allowlist.");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-10rem)] max-w-4xl items-center py-10">
      <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-[#5661d8]">
            <ShieldCheck size={17} />
            Private owner access
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight text-[#171b24]">
            Stealth control room.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-[#687180]">
            This route is reserved for allowlisted owner accounts. Waitlist members do not receive product access.
          </p>
        </div>

        <Card className="p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <Mail size={15} />
                Owner email
              </span>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="owner@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <LockKeyhole size={15} />
                Password
              </span>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Owner password"
                autoComplete="current-password"
                required
              />
            </label>

            {error ? (
              <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" size={16} /> : null}
              Sign in as owner
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
