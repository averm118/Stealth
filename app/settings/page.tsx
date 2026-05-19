"use client";

import { Bell, Database, Shield, UserRound } from "lucide-react";
import type { ElementType } from "react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const { profile, savedJobs } = useAppState();
  const [email, setEmail] = useState("Signed in");

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    void supabase?.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "Signed in");
    });
  }, []);

  return (
    <div className="grid gap-6 pb-24 lg:grid-cols-[0.85fr_1.15fr]">
      <Reveal>
      <Card className="p-7">
        <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
          <UserRound size={16} />
          Profile settings
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-[-0.055em] text-[#171b24]">Student profile</h1>
        <p className="mt-4 text-sm leading-6 text-[#687180]">{profile.headline}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {profile.targetRoles.map((role) => <Badge key={role}>{role}</Badge>)}
        </div>
      </Card>
      </Reveal>
      <Stagger className="grid gap-5 md:grid-cols-2">
        <SettingCard icon={Shield} title="Visa preference" value={profile.visaSponsorshipNeeded ? "Sponsorship-aware scoring on" : "Standard scoring"} />
        <SettingCard icon={Bell} title="Alerts" value="Mock instant alerts enabled" />
        <SettingCard icon={Database} title="Data layer" value={`${Object.keys(savedJobs).length} saved jobs synced with Supabase`} />
        <SettingCard icon={UserRound} title="Account" value={email} />
      </Stagger>
      <Reveal className="lg:col-span-2">
      <Card className="p-7">
        <h2 className="text-lg font-semibold text-[#171b24]">Integration notes</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            "Supabase: auth, profiles, saved jobs, match scores, and job tables are connected.",
            "AI: resume extraction and job compatibility run through server-side API routes.",
            "Radar: deterministic dashboard scoring stays fast while job detail analysis goes deeper."
          ].map((note) => (
            <p key={note} className="rounded-3xl border border-black/[0.05] bg-[#fbfbfd] p-4 text-sm leading-6 text-[#687180]">{note}</p>
          ))}
        </div>
      </Card>
      </Reveal>
    </div>
  );
}

function SettingCard({ icon: Icon, title, value }: Readonly<{ icon: ElementType; title: string; value: string }>) {
  return (
    <StaggerItem>
    <Card className="p-5">
      <Icon className="text-[#5661d8]" size={22} />
      <h2 className="mt-4 text-lg font-semibold text-[#171b24]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#687180]">{value}</p>
    </Card>
    </StaggerItem>
  );
}
