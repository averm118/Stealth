"use client";

import { Check, FileUp, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/motion-primitives";
import { extractCandidateProfile } from "@/lib/ai";
import type { CandidateProfile } from "@/lib/types";

export default function ProfilePage() {
  const { profile, updateProfile } = useAppState();
  const [sponsorshipNeeded, setSponsorshipNeeded] = useState(profile.visaSponsorshipNeeded);
  const [uploadState, setUploadState] = useState<{
    loading: boolean;
    message: string;
    error: string;
    fileName: string;
  }>({
    loading: false,
    message: "",
    error: "",
    fileName: ""
  });

  useEffect(() => {
    setSponsorshipNeeded(profile.visaSponsorshipNeeded);
  }, [profile.visaSponsorshipNeeded]);

  function handleSponsorshipToggle(nextValue: boolean) {
    setSponsorshipNeeded(nextValue);
    updateProfile({
      ...profile,
      visaSponsorshipNeeded: nextValue
    });
  }

  async function handleResumeUpload(file: File | undefined) {
    if (!file) return;

    setUploadState({
      loading: true,
      message: "Reading resume structure...",
      error: "",
      fileName: file.name
    });

    const formData = new FormData();
    formData.append("resume", file);

    try {
      const response = await fetch("/api/resume/parse", {
        method: "POST",
        body: formData
      });
      const result = (await response.json()) as {
        text?: string;
        sectionNames?: string[];
        error?: string;
      };

      if (!response.ok || !result.text) {
        throw new Error(result.error ?? "Could not parse this resume.");
      }

      updateProfile({
        ...extractCandidateProfile(result.text),
        visaSponsorshipNeeded: sponsorshipNeeded
      });
      setUploadState({
        loading: false,
        message: `${file.name} uploaded and analyzed.`,
        error: "",
        fileName: file.name
      });
    } catch (error) {
      setUploadState({
        loading: false,
        message: "",
        error: error instanceof Error ? error.message : "Could not parse this resume.",
        fileName: file.name
      });
    }
  }

  return (
    <div className="grid gap-6 pb-24 lg:grid-cols-2 lg:items-stretch">
      <Reveal className="h-full">
      <Card className="flex h-full min-h-[680px] flex-col p-8">
        <PanelHeader
          label="Resume"
          title="Upload your resume"
          description="Stealth reads your file structurally and creates a concise profile from the resume only."
        />

        <label className="mt-8 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-[30px] border border-dashed border-[#bdc5ff] bg-[#f7f8ff]/80 px-6 py-10 text-center transition hover:-translate-y-0.5 hover:border-[#8b96ff] hover:bg-white hover:shadow-[0_24px_70px_rgba(86,97,216,0.12)]">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-[#5661d8] shadow-sm">
            {uploadState.loading ? <Loader2 className="animate-spin" size={22} /> : <FileUp size={22} />}
          </span>
          <span className="mt-5 text-base font-semibold text-[#171b24]">
            {uploadState.loading ? "Analyzing resume" : "Choose resume file"}
          </span>
          <span className="mt-2 text-sm text-[#7a828f]">PDF, DOCX, TXT, or MD</span>
          <input
            className="sr-only"
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            onChange={(event) => {
              void handleResumeUpload(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>

        {(uploadState.message || uploadState.error || uploadState.fileName) && (
          <p className={`mt-4 text-sm leading-6 ${uploadState.error ? "text-rose-600" : "text-[#687180]"}`}>
            {uploadState.error || uploadState.message || `Selected ${uploadState.fileName}`}
          </p>
        )}

        <div className="mt-8 rounded-[26px] border border-black/[0.06] bg-white/70 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <ShieldCheck size={16} className="text-[#5661d8]" />
                Sponsorship needed
              </p>
              <p className="mt-1 text-sm leading-6 text-[#687180]">Prioritize roles with stronger visa support signals.</p>
            </div>
            <button
              type="button"
              aria-pressed={sponsorshipNeeded}
              onClick={() => handleSponsorshipToggle(!sponsorshipNeeded)}
              className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
                sponsorshipNeeded ? "border-[#5661d8] bg-[#5661d8]" : "border-black/[0.08] bg-[#eef0f5]"
              }`}
            >
              <span
                className={`absolute top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-[#5661d8] shadow-sm transition ${
                  sponsorshipNeeded ? "left-6" : "left-1"
                }`}
              >
                {sponsorshipNeeded && <Check size={12} />}
              </span>
            </button>
          </div>
        </div>
      </Card>
      </Reveal>

      <Reveal delay={0.08} className="h-full">
        <Card className="flex h-full min-h-[680px] flex-col p-8">
          <MinimalProfileSummary profile={profile} />
        </Card>
      </Reveal>
    </div>
  );
}

function MinimalProfileSummary({ profile }: Readonly<{ profile: CandidateProfile }>) {
  const confidence = getProfileConfidence(profile);
  const profileTitle = getProfileTitle(profile);
  const evidence = [
    cleanDefault(profile.education[0]),
    ...profile.experienceFocus.slice(0, 2)
  ].filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        label="Profile"
        title={profileTitle}
        description="A concise summary generated from your latest resume."
        icon={<UserRound size={16} />}
      />

      <div className="mt-8 rounded-[30px] border border-black/[0.06] bg-[#f7f8ff]/70 p-5 shadow-sm">
        <ProfileRow label="Best fit" value={profile.targetRoles.slice(0, 2).join(", ")} />
        <ProfileRow label="Skills" value={profile.skills.slice(0, 5).join(", ")} />
        <ProfileRow label="Evidence" value={evidence.join(" · ") || "Add more resume detail for stronger evidence."} />
        <ProfileRow
          label="Visa"
          value={profile.visaSponsorshipNeeded ? "Sponsorship-aware matching enabled" : "No sponsorship requirement detected"}
        />
      </div>

      <div className="mt-8 rounded-[26px] border border-black/[0.06] bg-white/70 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#171b24]">Profile confidence</p>
            <p className="mt-1 text-sm leading-6 text-[#687180]">
              Based only on the uploaded resume and your sponsorship preference.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs font-medium text-[#687180] shadow-sm">
            {confidence}
          </span>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({
  label,
  title,
  description,
  icon
}: Readonly<{ label: string; title: string; description: string; icon?: React.ReactNode }>) {
  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
        {icon}
        {label}
      </p>
      <h1 className="mt-3 max-w-xl text-4xl font-semibold leading-tight tracking-[-0.045em] text-[#171b24]">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-[#687180]">{description}</p>
    </div>
  );
}

function ProfileRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="border-b border-black/[0.06] px-1 py-4 first:pt-0 last:border-b-0 last:pb-0">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">{label}</p>
      <p className="mt-2 text-sm leading-6 text-[#384150]">{value}</p>
    </div>
  );
}

function getProfileTitle(profile: CandidateProfile) {
  const topRole = profile.targetRoles[0]?.replace(" Intern", "");
  const education = cleanDefault(profile.education[0]);

  if (topRole && education) return `${topRole} profile`;
  if (topRole) return `${topRole} candidate`;
  return "Candidate profile";
}

function getProfileConfidence(profile: CandidateProfile) {
  const hasEducation = profile.education.some((item) => !item.toLowerCase().includes("not extracted"));
  if (hasEducation && profile.skills.length >= 5 && profile.targetRoles.length >= 1) return "High";
  if (profile.skills.length >= 3 || hasEducation) return "Medium";
  return "Low";
}

function cleanDefault(value?: string) {
  if (!value || value.toLowerCase().includes("not extracted")) return "";
  return value;
}
