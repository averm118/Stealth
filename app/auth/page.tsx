"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type AuthMode = "sign-in" | "sign-up";

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthShell />}>
      <AuthForm />
    </Suspense>
  );
}

function AuthShell() {
  return (
    <div className="mx-auto grid min-h-[calc(100vh-10rem)] max-w-5xl items-center py-10">
      <Card className="p-8">
        <div className="h-11 rounded-full bg-black/[0.04]" />
        <div className="mt-8 h-12 rounded-3xl bg-black/[0.04]" />
        <div className="mt-4 h-12 rounded-3xl bg-black/[0.04]" />
      </Card>
    </div>
  );
}

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const redirectTo = useMemo(() => searchParams.get("redirectTo") ?? "/dashboard", [searchParams]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setLoading(false);
      setError("Supabase is not configured yet.");
      return;
    }

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`
            }
          });

    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (mode === "sign-up" && !result.data.session) {
      setMessage("Check your email to confirm your account, then sign in.");
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-10rem)] max-w-5xl items-center py-10">
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="text-sm font-medium text-[#5661d8]">Stealth account</p>
          <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-[-0.055em] text-[#171b24]">
            Your radar, saved securely.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-[#687180]">
            Sign in to save your resume profile, tracker statuses, and AI match history across devices.
          </p>
        </div>

        <Card className="p-8">
          <div className="flex rounded-full border border-black/[0.06] bg-white/70 p-1">
            {(["sign-in", "sign-up"] as AuthMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMode(item);
                  setError("");
                  setMessage("");
                }}
                className={`h-11 flex-1 rounded-full text-sm font-medium transition ${
                  mode === item ? "bg-[#171b24] text-white shadow-sm" : "text-[#687180] hover:text-[#171b24]"
                }`}
              >
                {item === "sign-in" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <Mail size={15} />
                Email
              </span>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
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
                placeholder="At least 6 characters"
                minLength={6}
                required
              />
            </label>

            {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
            {message && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading && <Loader2 className="animate-spin" size={16} />}
              {mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
