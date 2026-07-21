"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SubmissionState = "idle" | "submitting" | "success" | "error";

export function WaitlistForm({ className }: Readonly<{ className?: string }>) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setState("error");
      setMessage("Enter a valid email address.");
      return;
    }

    setState("submitting");
    setMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, website })
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; error?: string };

      if (!response.ok || !result.ok) {
        setState("error");
        setMessage(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      setState("success");
      setMessage(result.message ?? "Thanks for joining the waitlist. We'll email you when Stealth is ready.");
    } catch {
      setState("error");
      setMessage("We could not reach the waitlist. Please try again.");
    }
  }

  return (
    <div id="waitlist" className={cn("w-full scroll-mt-28", className)}>
      {state === "success" ? (
        <div
          role="status"
          className="mx-auto flex max-w-2xl items-start gap-3 rounded-[24px] border border-emerald-200/80 bg-emerald-50/75 px-5 py-4 text-left shadow-[0_20px_60px_rgba(15,118,110,0.14)] backdrop-blur-xl"
        >
          <CheckCircle2 className="mt-0.5 shrink-0 text-[#0f766e]" size={21} />
          <div>
            <p className="font-semibold text-[#10141d]">You&apos;re on the list.</p>
            <p className="mt-1 text-sm leading-6 text-[#384253]">{message}</p>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-2xl rounded-[26px] border border-white/75 bg-white/34 p-2 shadow-[0_28px_80px_rgba(30,42,96,0.20)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/50"
          noValidate
        >
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="waitlist-website">Website</label>
            <input
              id="waitlist-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Email address</span>
              <Mail
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#5661d8]"
              />
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (state === "error") {
                    setState("idle");
                    setMessage("");
                  }
                }}
                placeholder="you@university.edu"
                required
                aria-invalid={state === "error"}
                aria-describedby={message ? "waitlist-message" : undefined}
                className="h-12 border-transparent bg-white/62 pl-11 text-[#10141d] placeholder:text-[#667186] focus-visible:ring-[#5661d8]"
              />
            </label>
            <Button type="submit" size="lg" className="h-12 px-6" disabled={state === "submitting"}>
              {state === "submitting" ? <Loader2 className="animate-spin" size={17} /> : null}
              Join the waitlist
            </Button>
          </div>
        </form>
      )}

      {state !== "success" ? (
        <div className="mt-3 min-h-6 text-center">
          {message ? (
            <p id="waitlist-message" role="alert" className="text-sm font-medium text-rose-700">
              {message}
            </p>
          ) : (
            <p className="text-xs font-medium text-[#465166]">
              Private access is opening gradually. No account is created yet.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
