"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookmarkCheck,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  Link2,
  LockKeyhole,
  MapPinned,
  Radar,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";
import { LandingCommunityTrust, ResumeIntegrityPanel } from "@/components/landing-trust";
import {
  EmployerBrandWall,
  JobSourceBanner,
  ResumeFormatBanner
} from "@/components/brand-ecosystem";
import { jobs } from "@/data/jobs";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";

const WavesShader = dynamic(
  () => import("@/components/ui/waves-shader").then((mod) => mod.ShaderComponent),
  { ssr: false }
);

const roleFilters = [
  {
    id: "supply",
    label: "Supply Chain",
    eyebrow: "Planning, sourcing, inventory",
    keywords: ["supply chain", "procurement", "forecasting", "inventory", "logistics"],
    tone: "text-[#5661d8]",
    chip: "bg-[#eef1ff] text-[#5661d8] ring-1 ring-[#dfe3ff]"
  },
  {
    id: "analytics",
    label: "Data + BI",
    eyebrow: "SQL, dashboards, product signals",
    keywords: ["data", "analytics", "sql", "tableau", "power bi", "python"],
    tone: "text-[#0f766e]",
    chip: "bg-[#e8faf6] text-[#0f766e] ring-1 ring-[#c8efe7]"
  },
  {
    id: "business",
    label: "Business Ops",
    eyebrow: "Process, stakeholders, insight",
    keywords: ["business", "operations", "stakeholder", "analyst"],
    tone: "text-[#7c3aed]",
    chip: "bg-[#f3efff] text-[#7c3aed] ring-1 ring-[#e4dcff]"
  }
];

const workflowSteps = [
  {
    id: "read",
    label: "Read",
    title: "Turn a resume into search signals.",
    copy: "Stealth extracts target roles, degree fit, tools, project evidence, sponsorship needs, and seniority level so the radar starts from who the student already is.",
    icon: FileText,
    stats: ["12 profile signals", "DOCX layout detected", "Evidence-backed skills"]
  },
  {
    id: "rank",
    label: "Rank",
    title: "Score jobs by fit, not keyword noise.",
    copy: "Openings are sorted by role lane, internship/new-grad intent, degree compatibility, sponsorship signals, freshness, and project overlap.",
    icon: Radar,
    stats: ["Role-first ranking", "Sponsor-aware filters", "Freshness weighting"]
  },
  {
    id: "apply",
    label: "Apply",
    title: "Generate sharper materials without breaking layout.",
    copy: "The resume tailor prefers in-place edits, preserves DOCX structure, and pairs each recommendation with the evidence that supports it.",
    icon: ClipboardCheck,
    stats: ["Layout-locked DOCX", "Cover letter draft", "Tracker-ready next step"]
  }
];

const productModules = [
  {
    title: "Resume Radar",
    copy: "Role lanes keep supply chain, operations, analytics, product, and business roles from collapsing into one noisy feed.",
    icon: Gauge,
    accent: "bg-[#eef1ff] text-[#5661d8] ring-1 ring-[#dfe3ff]"
  },
  {
    title: "Job URL Import",
    copy: "Paste a role from a company site and Stealth turns it into a scored job page with a compatibility brief.",
    icon: Link2,
    accent: "bg-[#e8faf6] text-[#0f766e] ring-1 ring-[#c8efe7]"
  },
  {
    title: "Layout Lock",
    copy: "DOCX tailoring avoids physical removals, protects dates and headings, and retries safely if spacing risk is detected.",
    icon: LockKeyhole,
    accent: "bg-[#fff5ef] text-[#c25a32] ring-1 ring-[#ffe0d2]"
  },
  {
    title: "Application Tracker",
    copy: "Saved, applied, interview, rejected, and offer states keep every high-signal opening organized after the first click.",
    icon: BookmarkCheck,
    accent: "bg-[#f0fdf4] text-[#15803d] ring-1 ring-[#ccefd8]"
  }
];

const tailoringProof = [
  {
    title: "Exact posting in.",
    copy: "Role keywords, tools, and signals."
  },
  {
    title: "Your resume out.",
    copy: "No generic AI template."
  },
  {
    title: "Evidence only.",
    copy: "Keywords backed by your file."
  },
  {
    title: "Cover letter matched.",
    copy: "Same role. Same proof."
  }
];

const resumeRewriteRows = [
  {
    before: "Supported procurement workflows.",
    after: "Forecasting, SAP, suppliers."
  },
  {
    before: "Built dashboards.",
    after: "SQL, Tableau, KPI impact."
  },
  {
    before: "Excited to apply.",
    after: "Specific proof for this role."
  }
];

const documentPreviewCards = [
  {
    label: "Original resume",
    title: "Inventory reports",
    tone: "text-[#505b70]",
    accent: "bg-[#c8cedf]",
    paper: "bg-white/50",
    lines: ["w-10/12", "w-8/12", "w-11/12", "w-7/12"]
  },
  {
    label: "Stealth tailored",
    title: "Forecasting + SAP",
    tone: "text-[#5661d8]",
    accent: "bg-[#5661d8]",
    paper: "bg-[#f8f9ff]/60",
    lines: ["w-11/12", "w-9/12", "w-10/12", "w-8/12"]
  },
  {
    label: "Cover letter",
    title: "Role-specific proof",
    tone: "text-[#0f766e]",
    accent: "bg-[#0f766e]",
    paper: "bg-[#f7fffc]/60",
    lines: ["w-9/12", "w-11/12", "w-8/12", "w-10/12"]
  }
];

export default function LandingPage() {
  const [activeRoleId, setActiveRoleId] = useState(roleFilters[0].id);
  const activeRole = roleFilters.find((role) => role.id === activeRoleId) ?? roleFilters[0];

  const stats = useMemo(() => {
    const companyCount = new Set(jobs.map((job) => job.company)).size;
    const sponsorAwareCount = jobs.filter((job) => job.sponsorshipFriendly === "high" || job.sponsorshipFriendly === "medium").length;
    const flexibleCount = jobs.filter((job) => job.workType === "Hybrid" || job.workType === "Remote").length;

    return {
      roles: Math.max(jobs.length, 1000),
      companies: Math.max(companyCount, 500),
      sponsorAware: Math.max(sponsorAwareCount, 300),
      flexible: flexibleCount
    };
  }, []);

  const featuredJobs = useMemo(() => getFeaturedJobs(activeRole.keywords), [activeRole.keywords]);

  return (
    <div className="relative isolate overflow-hidden text-[#121722]">
      <LandingBackground />

      <section className="relative mx-auto flex min-h-screen max-w-7xl flex-col items-center justify-center px-4 pb-16 pt-32 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-5xl text-center">
          <Reveal>
            <div className="mx-auto inline-flex max-w-[17rem] items-center gap-2 rounded-full border border-white/70 bg-white/40 px-3 py-2 text-xs font-medium text-[#3f4a5e] shadow-[0_18px_48px_rgba(86,97,216,0.14)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40 sm:max-w-full sm:px-4 sm:text-sm">
              <Sparkles size={16} className="text-[#5661d8]" />
              <span className="truncate">Resume in. Matched roles out.</span>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 className="mx-auto mt-7 max-w-[18rem] text-balance text-5xl font-semibold leading-[1.02] text-[#10141d] sm:max-w-5xl sm:text-7xl sm:leading-none lg:text-8xl">
              Apply with a resume that already fits.
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="mx-auto mt-6 max-w-[18rem] text-base leading-7 text-[#384253] sm:max-w-2xl sm:text-xl sm:leading-8">
              Stealth turns your real resume into ranked internships, sharper bullets, and matched cover letters without generic AI templates.
            </p>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6">
                <Link href="/dashboard">
                  Open radar
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="h-12 px-6">
                <Link href="/profile">
                  Upload resume
                  <FileText size={18} />
                </Link>
              </Button>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.32} className="mx-auto mt-12 w-full max-w-6xl">
          <HeroProductScene featuredJobs={featuredJobs} stats={stats} />
        </Reveal>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <LandingCommunityTrust />
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <MinimalSignalStrip />
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Reveal>
          <RadarConsole
            activeRole={activeRole}
            activeRoleId={activeRoleId}
            featuredJobs={featuredJobs}
            stats={stats}
            onRoleChange={setActiveRoleId}
          />
        </Reveal>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Reveal>
          <EmployerBrandWall />
        </Reveal>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <TailoringShowcase />
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <ResumeIntegrityPanel />
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <MinimalToolGallery />
      </section>

      <section className="relative mx-auto max-w-7xl px-4 pb-24 pt-12 sm:px-6 lg:px-8">
        <Reveal>
          <div className="overflow-hidden rounded-[36px] border border-white/60 bg-white/30 p-6 shadow-[0_34px_110px_rgba(86,97,216,0.16)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40 sm:p-8 lg:p-10">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#5661d8]">Start with one file</p>
                <h2 className="mt-4 max-w-2xl text-balance text-4xl font-semibold leading-tight text-[#10141d] sm:text-5xl">
                  Your search, cleaned up.
                </h2>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-[#384253]">
                  Upload once. Rank better roles. Tailor without breaking your resume.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 justify-center px-6">
                  <Link href="/profile">
                    Upload resume
                    <ArrowRight size={18} />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary" className="h-12 justify-center px-6">
                  <Link href="/dashboard">
                    Browse radar
                    <Radar size={18} />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

function LandingBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 h-[100dvh] w-screen overflow-hidden bg-[#eaf0ff] [contain:paint]">
      <WavesShader sizing="viewport" pixelRatioCap={1.25} className="absolute inset-0 opacity-[0.92] mix-blend-multiply" />
      <div className="absolute inset-0 bg-[linear-gradient(118deg,rgba(86,97,216,0.34),transparent_33%),linear-gradient(248deg,rgba(8,145,178,0.24),transparent_30%),linear-gradient(32deg,rgba(255,132,73,0.24),transparent_31%),linear-gradient(305deg,rgba(124,58,237,0.20),transparent_34%),linear-gradient(180deg,rgba(246,248,255,0.12)_0%,rgba(255,255,255,0.16)_42%,rgba(235,240,255,0.18)_100%)]" />
      <div className="absolute -left-[22vw] top-[14vh] h-[46rem] w-[44rem] -rotate-12 bg-[linear-gradient(135deg,rgba(20,28,58,0.26),rgba(20,28,58,0.06)_42%,transparent_72%)] blur-3xl" />
      <div className="absolute -right-[20vw] top-[4vh] h-[38rem] w-[42rem] rotate-12 bg-[linear-gradient(225deg,rgba(86,97,216,0.30),rgba(20,184,166,0.12)_48%,transparent_76%)] blur-3xl" />
      <div className="absolute bottom-[-18rem] left-[22vw] h-[36rem] w-[56rem] -rotate-6 bg-[linear-gradient(95deg,rgba(20,184,166,0.20),rgba(255,122,69,0.14)_46%,transparent_78%)] blur-3xl" />
      <div className="absolute inset-0 bg-[conic-gradient(from_210deg_at_58%_42%,rgba(20,24,48,0.24),rgba(255,255,255,0.18),rgba(86,97,216,0.28),rgba(20,184,166,0.18),rgba(255,132,73,0.16),rgba(20,24,48,0.24))] opacity-55 mix-blend-overlay" />
      <div className="absolute inset-0 bg-[linear-gradient(124deg,rgba(255,255,255,0.44)_0%,transparent_18%,rgba(15,23,42,0.16)_34%,transparent_52%,rgba(255,255,255,0.34)_72%,transparent_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(86,97,216,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(86,97,216,0.09)_1px,transparent_1px)] bg-[size:72px_72px] opacity-80" />
      <div className="absolute inset-0 shadow-[inset_0_0_220px_rgba(10,14,28,0.20)]" />
      <div className="absolute inset-x-0 top-0 h-64 bg-[linear-gradient(180deg,rgba(238,242,255,0.66),transparent)]" />
    </div>
  );
}

function HeroProductScene({
  featuredJobs,
  stats
}: Readonly<{
  featuredJobs: Job[];
  stats: { roles: number; companies: number; sponsorAware: number; flexible: number };
}>) {
  const primaryJob = featuredJobs[0] ?? jobs[0];

  return (
    <div className="relative overflow-hidden rounded-[36px] border border-white/75 bg-white/30 p-3 shadow-[0_40px_130px_rgba(30,42,96,0.22)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40 sm:p-4 lg:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_26%_14%,rgba(255,255,255,0.62),transparent_30%),radial-gradient(circle_at_78%_12%,rgba(20,184,166,0.16),transparent_32%),linear-gradient(120deg,rgba(86,97,216,0.10),transparent_52%)]" />
      <div className="relative grid gap-4 lg:grid-cols-[0.9fr_1.15fr_0.9fr] lg:items-stretch">
        <motion.div
          initial={{ opacity: 0, y: 24, rotate: -2 }}
          whileInView={{ opacity: 1, y: 0, rotate: -1 }}
          whileHover={{ y: -8, rotate: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55 }}
        >
          <DocumentPicture eyebrow="Uploaded resume" title="Proof extracted" accent="bg-[#5661d8]" tone="text-[#5661d8]" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.08, duration: 0.55 }}
          className="flex min-h-[320px] flex-col justify-between rounded-[30px] border border-white/70 bg-white/50 p-5 shadow-[0_26px_80px_rgba(20,28,58,0.14)]"
        >
          <div>
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#5661d8]">
                <Radar size={17} />
                Live match
              </p>
              <span className="rounded-full border border-[#bdeedc] bg-[#ecfdf5] px-3 py-1 text-xs font-semibold text-[#047857]">
                92% fit
              </span>
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#505b70]">{primaryJob.company}</p>
            <h3 className="mt-2 text-balance text-3xl font-semibold leading-tight text-[#10141d]">{primaryJob.title}</h3>
            <div className="mt-5 flex flex-wrap gap-2">
              {primaryJob.skills.slice(0, 4).map((skill) => (
                <span key={skill} className="rounded-full border border-[#dfe3ff] bg-white/50 px-3 py-1.5 text-xs font-semibold text-[#4b5563] shadow-sm">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-8">
            <div className="grid gap-3 sm:grid-cols-3">
              <SceneMetric label="roles covered" value={`${stats.roles}+`} icon={BriefcaseBusiness} />
              <SceneMetric label="companies indexed" value={`${stats.companies}+`} icon={MapPinned} />
              <SceneMetric label="sponsor-aware roles" value={`${stats.sponsorAware}+`} icon={ShieldCheck} />
            </div>
            <p className="mt-3 text-xs font-medium leading-5 text-[#465166]">
              Catalog coverage varies with source availability and refresh timing.
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, rotate: 2 }}
          whileInView={{ opacity: 1, y: 0, rotate: 1 }}
          whileHover={{ y: -8, rotate: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.16, duration: 0.55 }}
        >
          <DocumentPicture eyebrow="Matched letter" title="Same evidence" accent="bg-[#0f766e]" tone="text-[#0f766e]" compact />
        </motion.div>
      </div>
    </div>
  );
}

function SceneMetric({
  label,
  value,
  icon: Icon
}: Readonly<{
  label: string;
  value: number | string;
  icon: typeof BriefcaseBusiness;
}>) {
  return (
    <div className="rounded-2xl border border-white/60 bg-white/40 p-3 shadow-sm">
      <Icon size={16} className="text-[#5661d8]" />
      <p className="mt-3 text-2xl font-semibold leading-none text-[#10141d]">{value}</p>
      <p className="mt-1 text-xs font-medium text-[#465166]">{label}</p>
    </div>
  );
}

function DocumentPicture({
  eyebrow,
  title,
  accent,
  tone,
  compact = false
}: Readonly<{
  eyebrow: string;
  title: string;
  accent: string;
  tone: string;
  compact?: boolean;
}>) {
  const lines = compact
    ? ["w-11/12", "w-10/12", "w-8/12", "w-11/12", "w-7/12"]
    : ["w-10/12", "w-8/12", "w-11/12", "w-7/12", "w-9/12"];

  return (
    <figure className="relative min-h-[320px] overflow-hidden rounded-[30px] border border-white/70 bg-white/50 p-5 shadow-[0_26px_80px_rgba(20,28,58,0.14)]">
      <div className={cn("absolute inset-x-0 top-0 h-1.5", accent)} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("text-xs font-semibold uppercase tracking-[0.16em]", tone)}>{eyebrow}</p>
          <h3 className="mt-2 text-xl font-semibold text-[#10141d]">{title}</h3>
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl bg-white/50 shadow-sm ring-1 ring-[#dfe3ff]", tone)}>
          <FileText size={18} />
        </div>
      </div>

      <div className="mt-7 space-y-4">
        {["Experience", "Projects", "Skills"].map((section, sectionIndex) => (
          <div key={section}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#667186]">{section}</p>
            <div className="space-y-2">
              {lines.slice(0, sectionIndex === 1 ? 2 : 1).map((width, lineIndex) => (
                <motion.div
                  key={`${section}-${width}-${lineIndex}`}
                  className={cn("h-2 rounded-full bg-[#dfe3ff]", width)}
                  initial={{ scaleX: 0.5, opacity: 0.55 }}
                  whileInView={{ scaleX: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: sectionIndex * 0.08 + lineIndex * 0.04, duration: 0.42 }}
                  style={{ transformOrigin: "left" }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <motion.div
        className={cn("absolute bottom-5 left-5 right-5 h-2 rounded-full", accent)}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: compact ? 0.64 : 0.82 }}
        viewport={{ once: true }}
        transition={{ delay: 0.35, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: "left" }}
      />
    </figure>
  );
}

function MinimalSignalStrip() {
  return (
    <Stagger className="grid gap-3 md:grid-cols-3">
      {workflowSteps.map((step, index) => {
        const Icon = step.icon;
        return (
          <StaggerItem key={step.id}>
            <motion.article
              whileHover={{ y: -5 }}
              className="group relative min-h-[190px] overflow-hidden rounded-[28px] border border-white/60 bg-white/30 p-5 shadow-[0_24px_78px_rgba(86,97,216,0.13)] ring-1 ring-[#dfe3ff]/40"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-[#eef1ff]">
                <motion.div
                  className="h-full rounded-r-full bg-[#5661d8]"
                  initial={{ width: 0 }}
                  whileInView={{ width: `${46 + index * 22}%` }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.07, duration: 0.65 }}
                />
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/50 text-[#5661d8] shadow-sm ring-1 ring-[#dfe3ff]">
                <Icon size={19} />
              </div>
              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.16em] text-[#505b70]">0{index + 1} / {step.label}</p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight text-[#10141d]">{step.title}</h2>
            </motion.article>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

function TailoringShowcase() {
  return (
    <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr] lg:items-stretch">
      <Reveal>
        <div className="flex h-full flex-col justify-between rounded-[32px] border border-white/60 bg-white/30 p-6 shadow-[0_30px_96px_rgba(86,97,216,0.14)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-[#5661d8]">
              <ClipboardCheck size={17} />
              Resume and cover
            </p>
            <h2 className="mt-5 max-w-xl text-balance text-4xl font-semibold leading-tight text-[#10141d] sm:text-5xl">
              Tailored, not templated.
            </h2>
            <p className="mt-4 max-w-lg text-lg leading-8 text-[#384253]">
              Keywords move into your existing resume. The cover letter uses the same proof.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {tailoringProof.map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/60 bg-white/40 p-4 shadow-[0_14px_40px_rgba(86,97,216,0.10)]">
                <p className="text-base font-semibold text-[#111827]">{item.title}</p>
                <p className="mt-1 text-sm font-medium text-[#475467]">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="overflow-hidden rounded-[32px] border border-white/60 bg-white/40 shadow-[0_34px_104px_rgba(20,28,58,0.15)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40">
          <div className="grid border-b border-[#dfe3ff] md:grid-cols-2">
            <div className="p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#5661d8]">
                <FileText size={17} />
                Job signals
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {["forecasting", "SAP", "KPIs", "SQL"].map((keyword) => (
                  <span key={keyword} className="rounded-full border border-[#dfe3ff] bg-white/50 px-3 py-1.5 text-xs font-semibold text-[#384253] shadow-sm">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
            <div className="border-t border-[#dfe3ff] p-5 md:border-l md:border-t-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-[#0f766e]">
                <Sparkles size={17} />
                Resume-safe output
              </p>
              <p className="mt-4 text-sm font-medium leading-6 text-[#384253]">
                No fake projects. No layout wreckage.
              </p>
            </div>
          </div>

          <ResumeDocumentFlow />
          <ResumeFormatBanner />

          <div className="grid divide-y divide-[#dfe3ff] md:grid-cols-3 md:divide-x md:divide-y-0">
            {resumeRewriteRows.map((row) => (
              <div key={row.before} className="p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#505b70]">Before</p>
                <p className="mt-2 text-sm font-medium text-[#4b5563]">{row.before}</p>
                <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-[#5661d8]">After</p>
                <p className="mt-2 text-base font-semibold text-[#111827]">{row.after}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}

function MinimalToolGallery() {
  return (
    <div className="relative overflow-hidden rounded-[36px] border border-white/60 bg-white/20 p-5 shadow-[0_34px_110px_rgba(86,97,216,0.15)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40 [contain:paint] sm:p-7">
      <div className="pointer-events-none absolute inset-0 opacity-60 [contain:paint]">
        <WavesShader
          sizing="element"
          pixelRatioCap={1.25}
          pauseWhenOffscreen
          intersectionMargin="0px"
          className="h-full w-full"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.42),rgba(255,255,255,0.10)_52%,rgba(86,97,216,0.10))]" />
      <div className="relative">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#5661d8]">Apply-ready tools</p>
            <h2 className="mt-3 text-balance text-4xl font-semibold leading-tight text-[#10141d] sm:text-5xl">
              Fewer tabs. Better artifacts.
            </h2>
          </div>
        </Reveal>

        <Stagger className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {productModules.map((module) => {
            const Icon = module.icon;
            return (
              <StaggerItem key={module.title}>
                <motion.article
                  whileHover={{ y: -6 }}
                  className="relative min-h-[210px] overflow-hidden rounded-[26px] border border-white/60 bg-white/40 p-5 shadow-[0_24px_74px_rgba(86,97,216,0.13)]"
                >
                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", module.accent)}>
                    <Icon size={20} />
                  </div>
                  <h3 className="mt-6 text-xl font-semibold text-[#10141d]">{module.title}</h3>
                  <div className="mt-5 space-y-2">
                    <div className="h-2 w-11/12 rounded-full bg-[#dfe3ff]" />
                    <div className="h-2 w-8/12 rounded-full bg-[#dfe3ff]" />
                    <div className="h-2 w-10/12 rounded-full bg-[#dfe3ff]" />
                  </div>
                </motion.article>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </div>
  );
}

function ResumeDocumentFlow() {
  const flowRef = useRef<HTMLDivElement>(null);
  const flowInView = useInView(flowRef, { margin: "180px 0px" });
  const reduceMotion = useReducedMotion();

  return (
    <div ref={flowRef} className="border-b border-[#dfe3ff] bg-white/30 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#384253]">
          <Sparkles size={16} className="text-[#5661d8]" />
          Evidence flow
        </p>
        <span className="rounded-full border border-[#dfe3ff] bg-white/50 px-3 py-1 text-xs font-semibold text-[#5661d8] shadow-sm">
          no template swap
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {documentPreviewCards.map((doc, index) => (
          <motion.div
            key={doc.label}
            initial={{ opacity: 0, y: 18, rotate: index === 0 ? -2 : index === 2 ? 2 : 0 }}
            whileInView={{ opacity: 1, y: 0, rotate: index === 0 ? -1 : index === 2 ? 1 : 0 }}
            whileHover={{ y: -6, rotate: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: index * 0.08, duration: 0.45 }}
            className={cn(
              "relative min-h-[190px] overflow-hidden rounded-2xl border border-white/80 p-4 shadow-[0_18px_50px_rgba(20,28,58,0.12)] ring-1 ring-[#dfe3ff]/40",
              doc.paper
            )}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-[#eef1ff]">
              <motion.div
                className={cn("h-full rounded-r-full", doc.accent)}
                initial={{ width: 0 }}
                whileInView={{ width: index === 0 ? "42%" : index === 1 ? "76%" : "62%" }}
                viewport={{ once: true }}
                transition={{ delay: 0.26 + index * 0.08, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>

            <div className="mb-4 flex items-start justify-between gap-2 pt-2">
              <div>
                <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", doc.tone)}>{doc.label}</p>
                <p className="mt-1 text-sm font-semibold text-[#111827]">{doc.title}</p>
              </div>
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-white/50 shadow-sm ring-1 ring-[#dfe3ff]", doc.tone)}>
                <FileText size={15} />
              </div>
            </div>

            <div className="space-y-2">
              {doc.lines.map((width, lineIndex) => (
                <motion.div
                  key={`${doc.label}-${lineIndex}`}
                  className={cn("h-2 rounded-full bg-[#dfe3ff]", width)}
                  initial={{ scaleX: 0.45, opacity: 0.55 }}
                  whileInView={{ scaleX: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.14 + index * 0.08 + lineIndex * 0.04, duration: 0.42 }}
                  style={{ transformOrigin: "left" }}
                />
              ))}
            </div>

            <motion.div
              className="absolute bottom-4 left-4 right-4 rounded-xl border border-[#dfe3ff] bg-white/40 p-2"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.34 + index * 0.08, duration: 0.4 }}
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", doc.accent)} />
                <span className="text-[11px] font-semibold text-[#384253]">
                  {index === 0 ? "source proof" : index === 1 ? "keyword fit" : "matched voice"}
                </span>
              </div>
            </motion.div>

            {index < documentPreviewCards.length - 1 ? (
              <motion.div
                className="absolute right-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[#dfe3ff] bg-white/60 text-[#5661d8] shadow-sm sm:flex"
                animate={!reduceMotion && flowInView ? { x: [0, 4, 0] } : { x: 0 }}
                transition={!reduceMotion && flowInView ? { duration: 1.45, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
              >
                <ArrowRight size={15} />
              </motion.div>
            ) : null}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function RadarConsole({
  activeRole,
  activeRoleId,
  featuredJobs,
  stats,
  onRoleChange
}: Readonly<{
  activeRole: (typeof roleFilters)[number];
  activeRoleId: string;
  featuredJobs: Job[];
  stats: { roles: number; companies: number; sponsorAware: number; flexible: number };
  onRoleChange: (roleId: string) => void;
}>) {
  return (
    <div className="overflow-hidden rounded-[36px] border border-white/70 bg-white/25 shadow-[0_40px_140px_rgba(86,97,216,0.20)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40">
      <div className="grid border-b border-[#dfe3ff] lg:grid-cols-[0.8fr_1.2fr]">
        <div className="p-5 sm:p-7">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#2563eb]">
            <Radar size={17} />
            Live radar preview
          </p>
          <h2 className="mt-4 max-w-xl text-balance text-3xl font-semibold leading-tight text-[#10141d] sm:text-4xl">
            Choose a search lane and watch the strongest openings reshuffle.
          </h2>
        </div>
        <div className="border-t border-[#dfe3ff] p-5 sm:p-7 lg:border-l lg:border-t-0">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Roles covered" value={`${stats.roles}+`} />
            <MiniStat label="Companies indexed" value={`${stats.companies}+`} />
            <MiniStat label="Sponsor-aware roles" value={`${stats.sponsorAware}+`} />
          </div>
          <p className="mt-3 text-xs font-medium text-[#465166]">
            Coverage varies by source availability and refresh timing.
          </p>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[280px_1fr_310px]">
        <div className="border-b border-[#dfe3ff] p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <p className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#596579]">Search lane</p>
          <div className="mt-3 space-y-2">
            {roleFilters.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => onRoleChange(role.id)}
                className={cn(
                  "w-full rounded-3xl border p-4 text-left transition",
                  activeRoleId === role.id
                    ? "border-[#cfd6ff] bg-[#eef1ff]/60 text-[#171b24] shadow-[0_20px_60px_rgba(86,97,216,0.16)] ring-1 ring-white/60"
                    : "border-white/50 bg-white/20 text-[#10141d] hover:bg-white/40"
                )}
              >
                <span className="block text-sm font-semibold">{role.label}</span>
                <span className={cn("mt-1 block text-xs", activeRoleId === role.id ? "text-[#465166]" : "text-[#4b5563]")}>
                  {role.eyebrow}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#10141d]">{activeRole.label} matches</p>
              <p className="mt-1 text-xs font-medium text-[#4b5563]">Ranked by role evidence, student fit, sponsorship, and freshness.</p>
            </div>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", activeRole.chip)}>
              {featuredJobs.length} surfaced
            </span>
          </div>
          <div className="space-y-3">
            {featuredJobs.map((job, index) => (
              <motion.div
                key={`${activeRole.id}-${job.id}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="grid gap-4 rounded-[24px] border border-white/60 bg-white/30 p-4 shadow-[0_18px_56px_rgba(86,97,216,0.11)] sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#505b70]">
                    <span className="text-[#4b5563]">{job.company}</span>
                    <span>/</span>
                    <span>{job.workType}</span>
                    <span>/</span>
                    <span>{job.sponsorshipFriendly === "high" ? "High sponsor signal" : "Sponsor-aware"}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-base font-semibold leading-6 text-[#10141d]">{job.title}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {job.skills.slice(0, 3).map((skill) => (
                      <span key={skill} className="rounded-full bg-white/50 px-2.5 py-1 text-xs font-medium text-[#414b5d] shadow-sm">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="rounded-full border border-[#bdeedc] bg-[#ecfdf5] px-3 py-1.5 text-xs font-semibold text-[#047857]">
                    Strong fit
                  </span>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/60 bg-white/50 text-[#10141d] shadow-sm transition hover:-translate-y-0.5 hover:text-[#5661d8]"
                    aria-label={`Open ${job.title}`}
                  >
                    <ArrowRight size={15} />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="border-t border-[#dfe3ff] p-4 sm:p-5 lg:border-l lg:border-t-0">
          <div className="rounded-[28px] border border-white/60 bg-white/30 p-5 text-[#171b24] shadow-[0_28px_90px_rgba(86,97,216,0.16)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Candidate signal</p>
              <BrainCircuit size={18} className={activeRole.tone} />
            </div>
            <div className="mt-6 space-y-4">
              <SignalBar label="Role evidence" value={91} color="bg-[#60a5fa]" />
              <SignalBar label="Degree alignment" value={84} color="bg-[#34d399]" />
              <SignalBar label="Application readiness" value={78} color="bg-[#fb923c]" />
            </div>
            <div className="mt-6 rounded-3xl border border-[#dfe3ff] bg-white/40 p-4 shadow-sm">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 size={16} className="text-[#34d399]" />
                Resume-backed edit path
              </p>
              <p className="mt-2 text-sm font-medium leading-6 text-[#465166]">
                Replace weak bullets first, add only when layout slack exists, and keep dates, headings, and contact details locked.
              </p>
            </div>
          </div>
        </div>
      </div>
      <JobSourceBanner />
    </div>
  );
}

function MiniStat({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <div className="rounded-3xl border border-white/60 bg-white/30 p-4 shadow-[0_16px_46px_rgba(86,97,216,0.10)]">
      <p className="text-2xl font-semibold text-[#10141d]">{value}</p>
      <p className="mt-1 text-xs font-medium text-[#4b5563]">{label}</p>
    </div>
  );
}

function SignalBar({
  label,
  value,
  color
}: Readonly<{
  label: string;
  value: number;
  color: string;
}>) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-[#465166]">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e8ebf5]">
        <motion.div
          className={cn("h-full rounded-full", color)}
          initial={{ width: 0 }}
          whileInView={{ width: `${value}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

function getFeaturedJobs(keywords: string[]) {
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const matches = jobs.filter((job) => {
    const text = `${job.title} ${job.description} ${job.skills.join(" ")}`.toLowerCase();
    return normalizedKeywords.some((keyword) => text.includes(keyword));
  });

  return (matches.length ? matches : jobs).slice(0, 4);
}
