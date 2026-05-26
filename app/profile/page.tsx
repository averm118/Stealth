"use client";

import { BriefcaseBusiness, Check, ChevronDown, FileUp, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppState } from "@/components/app-state";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/motion-primitives";
import { storeLocalResumeDocument } from "@/lib/resume-local-document";
import type { CandidateProfile, LookingFor, ResumeDocumentMetadata } from "@/lib/types";

const lookingForOptions: LookingFor[] = ["Internship", "Full-time job", "Part-time job"];

export default function ProfilePage() {
  const { profile, updateProfile } = useAppState();
  const [sponsorshipNeeded, setSponsorshipNeeded] = useState(profile.visaSponsorshipNeeded);
  const [lookingFor, setLookingFor] = useState<LookingFor>(profile.lookingFor);
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

  useEffect(() => {
    setLookingFor(profile.lookingFor);
  }, [profile.lookingFor]);

  function handleSponsorshipToggle(nextValue: boolean) {
    setSponsorshipNeeded(nextValue);
    updateProfile({
      ...profile,
      visaSponsorshipNeeded: nextValue
    });
  }

  function handleLookingForChange(nextValue: LookingFor) {
    setLookingFor(nextValue);
    updateProfile({
      ...profile,
      lookingFor: nextValue
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
        textHash?: string;
        sectionNames?: string[];
        resumeDocument?: ResumeDocumentMetadata | null;
        documentWarning?: string;
        error?: string;
      };

      if (!response.ok || !result.text) {
        throw new Error(result.error ?? "Could not parse this resume.");
      }

      let localResumeDocument: ResumeDocumentMetadata | null = null;
      try {
        localResumeDocument = result.textHash ? await storeLocalResumeDocument(file, result.textHash) : null;
      } catch {
        localResumeDocument = null;
      }
      const resumeDocument = result.resumeDocument ?? localResumeDocument ?? null;

      const extractionResponse = await fetch("/api/profile/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText: result.text,
          visaSponsorshipNeeded: sponsorshipNeeded,
          lookingFor
        })
      });
      const extractionResult = (await extractionResponse.json()) as {
        profile?: CandidateProfile;
        source?: "gemini" | "local_fallback";
        warning?: string;
        error?: string;
      };

      if (!extractionResponse.ok || !extractionResult.profile) {
        throw new Error(extractionResult.error ?? "Could not extract this resume profile.");
      }

      updateProfile({
        ...extractionResult.profile,
        resumeDocument,
        visaSponsorshipNeeded: sponsorshipNeeded,
        lookingFor
      });

      const hasLayoutPreservingDocx = Boolean(resumeDocument?.exactLayoutSupported);
      setUploadState({
        loading: false,
        message:
          extractionResult.source === "local_fallback"
            ? `${file.name} uploaded. Local fallback used because AI extraction was unavailable.`
            : hasLayoutPreservingDocx
              ? `${file.name} uploaded and analyzed with AI. DOCX layout will be preserved for tailored downloads.`
              : `${file.name} uploaded and analyzed with AI. PDF downloads will use the one-page Stealth template.`,
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

        <div className="mt-4 rounded-[26px] border border-black/[0.06] bg-white/70 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-[#171b24]">
                <BriefcaseBusiness size={16} className="text-[#5661d8]" />
                Looking for
              </p>
              <p className="mt-1 text-sm leading-6 text-[#687180]">Tune matches around your current search type.</p>
            </div>
            <label className="relative w-full sm:w-48">
              <span className="sr-only">Looking for</span>
              <select
                value={lookingFor}
                onChange={(event) => handleLookingForChange(event.target.value as LookingFor)}
                className="h-11 w-full appearance-none rounded-full border border-black/[0.08] bg-white px-4 pr-10 text-sm font-medium text-[#171b24] shadow-sm outline-none transition hover:bg-[#fbfbfd] focus:border-[#bdc5ff] focus:ring-2 focus:ring-[#bdc5ff]/40"
              >
                {lookingForOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#7a828f]"
              />
            </label>
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
  const bestFitRoles = getBestFitRoles(profile);
  const summary = getConciseSummary(profile);
  const strongAspects = getStrongAspects(profile);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        label="Profile"
        title={profileTitle}
        description={summary}
        icon={<UserRound size={16} />}
      />

      <div className="mt-8 rounded-[30px] border border-black/[0.06] bg-[#f7f8ff]/70 p-5 shadow-sm">
        <ProfileRow label="Best fit" value={bestFitRoles.join(", ")} />
        <ProfileRow label="Skills" value={profile.skills.slice(0, 5).join(", ")} />
        <ProfileRow label="Strong aspects" value={strongAspects.join(" · ")} />
        <ProfileRow
          label="Visa"
          value={profile.visaSponsorshipNeeded ? "Sponsorship-aware matching enabled" : "No sponsorship requirement detected"}
        />
        <ProfileRow label="Looking for" value={profile.lookingFor} />
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

function getBestFitRoles(profile: CandidateProfile) {
  const baseRoles = profile.targetRoles.length ? profile.targetRoles : ["Data Analyst"];

  return baseRoles.slice(0, 2).map((role) => formatRoleForSearchType(role, profile.lookingFor));
}

function formatRoleForSearchType(role: string, lookingFor: LookingFor) {
  const normalized = role
    .replace(/\s+Internship$/i, "")
    .replace(/\s+Intern$/i, "")
    .replace(/\s+Part[-\s]?time$/i, "")
    .replace(/\s+Full[-\s]?time$/i, "")
    .trim();

  if (lookingFor === "Internship") {
    return /\bintern\b/i.test(role) ? role : `${normalized} Intern`;
  }

  if (lookingFor === "Part-time job") {
    return `Part-time ${normalized}`;
  }

  return normalized;
}

function getConciseSummary(profile: CandidateProfile) {
  const headline = cleanDefault(profile.headline);
  const skills = profile.skills.slice(0, 3).join(", ");
  const focus = profile.experienceFocus.slice(0, 2).join(" and ");

  if (headline && headline !== defaultSummary(profile)) return headline;
  if (skills && focus) return `${profile.lookingFor} candidate with ${skills} strengths across ${focus}.`;
  if (skills) return `${profile.lookingFor} candidate with ${skills} strengths.`;
  return `Profile generated from your latest resume for ${profile.lookingFor.toLowerCase()} roles.`;
}

function getStrongAspects(profile: CandidateProfile) {
  const strengths = profile.strengths.map(toSentenceCase);
  const focus = profile.experienceFocus.slice(0, 2).map(toSentenceCase);
  const education = cleanDefault(profile.education[0]);
  const aspects = [...strengths, ...focus, education].filter(Boolean);

  return [...new Set(aspects)].slice(0, 3).length
    ? [...new Set(aspects)].slice(0, 3)
    : ["Resume uploaded", "Profile extracted", "Ready for matching"];
}

function defaultSummary(profile: CandidateProfile) {
  return profile.lookingFor === "Internship"
    ? "ASU student exploring analyst and AI internship roles"
    : "ASU student exploring analyst and AI roles";
}

function toSentenceCase(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
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
