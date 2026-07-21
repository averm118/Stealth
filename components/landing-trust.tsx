"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Users
} from "lucide-react";

type UniversityProof = {
  name: string;
  logo: string;
};

type LandingTrustProof =
  | {
      status: "draft";
      studentCount: string;
      universityCount: string;
      universities: UniversityProof[];
    }
  | {
      status: "verified";
      studentCount: string;
      universityCount: string;
      universities: UniversityProof[];
      sourceNote: string;
    };

const landingTrustProof: LandingTrustProof = {
  status: "draft",
  studentCount: "500+",
  universityCount: "40+",
  universities: [
    { name: "Arizona State University", logo: "/university-logos/asu.svg" },
    { name: "UCLA", logo: "/university-logos/ucla.svg" },
    { name: "The University of Texas at Dallas", logo: "/university-logos/ut-dallas.svg" },
    { name: "University of Washington", logo: "/university-logos/washington.svg" },
    { name: "Northeastern University", logo: "/university-logos/northeastern.svg" },
    { name: "Purdue University", logo: "/university-logos/purdue.svg" },
    { name: "University of Maryland", logo: "/university-logos/maryland.svg" },
    { name: "Georgia Institute of Technology", logo: "/university-logos/georgia-tech.svg" }
  ]
};

const productSafeguards = [
  {
    title: "Evidence-backed",
    copy: "Every edit starts with your uploaded resume.",
    icon: FileCheck2,
    tone: "text-[#5661d8]"
  },
  {
    title: "Unsupported claims blocked",
    copy: "Missing tools and experience stay missing.",
    icon: ShieldCheck,
    tone: "text-[#0f766e]"
  },
  {
    title: "Layout locked",
    copy: "Dates, headings, and DOCX structure stay protected.",
    icon: LockKeyhole,
    tone: "text-[#7c3aed]"
  }
];

const integrityChecks = [
  {
    title: "Resume evidence checked",
    copy: "Suggested language maps back to existing skills, projects, or experience.",
    status: "Checked",
    icon: FileCheck2,
    tone: "text-[#5661d8]",
    bar: "bg-[#5661d8]"
  },
  {
    title: "Unsupported additions blocked",
    copy: "Stealth skips tools, metrics, projects, and claims your file cannot support.",
    status: "Blocked",
    icon: ShieldCheck,
    tone: "text-[#0f766e]",
    bar: "bg-[#0f766e]"
  },
  {
    title: "Layout and dates preserved",
    copy: "Physical removals are disabled and locked resume structure stays intact.",
    status: "Locked",
    icon: LockKeyhole,
    tone: "text-[#7c3aed]",
    bar: "bg-[#7c3aed]"
  }
];

export function LandingCommunityTrust() {
  const reduceMotion = useReducedMotion();
  const marqueeRef = useRef<HTMLDivElement>(null);
  const marqueeInView = useInView(marqueeRef, { margin: "240px 0px" });
  const showCommunityPreview = landingTrustProof.status === "verified" || process.env.NODE_ENV !== "production";

  if (!showCommunityPreview) {
    return <ProductSafeguardStrip />;
  }

  const universitySets = reduceMotion
    ? [landingTrustProof.universities]
    : [landingTrustProof.universities, landingTrustProof.universities];

  return (
    <div className="overflow-hidden rounded-[32px] border border-white/60 bg-white/25 shadow-[0_28px_90px_rgba(86,97,216,0.14)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40">
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#5661d8]">
              <Users size={17} />
              Student community
            </p>
          </div>
          <h2 className="mt-3 max-w-2xl text-balance text-3xl font-semibold leading-tight text-[#10141d] sm:text-4xl">
            Trusted by students building their next move.
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TrustCounter value={landingTrustProof.studentCount} label="students" />
          <TrustCounter value={landingTrustProof.universityCount} label="universities" />
        </div>
      </div>

      <div className="border-t border-white/40 py-4">
        <div
          ref={marqueeRef}
          className={reduceMotion ? "overflow-x-auto px-5 thin-scrollbar" : "overflow-hidden [contain:paint]"}
        >
          <div
            className={reduceMotion ? "flex w-max" : "landing-marquee-track flex w-max"}
            data-paused={!marqueeInView}
            style={reduceMotion ? undefined : { animationDuration: "28s", animationPlayState: marqueeInView ? "running" : "paused" }}
          >
            {universitySets.map((universities, setIndex) => (
              <div
                key={`university-set-${setIndex}`}
                className="flex shrink-0 gap-3 pr-3"
                aria-hidden={setIndex > 0}
              >
                {universities.map((university) => (
                  <div
                    key={`${setIndex}-${university.name}`}
                    className="flex h-16 min-w-[210px] items-center justify-center rounded-2xl border border-white/60 bg-white/40 px-5 shadow-sm"
                  >
                    <Image
                      src={university.logo}
                      alt={`${university.name} logo`}
                      width={180}
                      height={44}
                      unoptimized
                      className="max-h-10 w-auto max-w-[170px] object-contain"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/40 px-5 py-3 text-xs font-medium text-[#465166] sm:px-7">
        not affiliated with any of these universities
      </div>
    </div>
  );
}

export function ResumeIntegrityPanel() {
  return (
    <div className="grid gap-5 overflow-hidden rounded-[36px] border border-white/60 bg-white/25 p-5 shadow-[0_34px_110px_rgba(86,97,216,0.15)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40 sm:p-7 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
      <div className="p-1 sm:p-3">
        <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.17em] text-[#0f766e]">
          <BadgeCheck size={18} />
          Resume integrity
        </p>
        <h2 className="mt-4 max-w-xl text-balance text-4xl font-semibold leading-tight text-[#10141d] sm:text-5xl">
          Your resume stays the source of truth.
        </h2>
        <p className="mt-4 max-w-lg text-lg leading-8 text-[#384253]">
          Stealth improves the language around evidence you already have. It does not manufacture a new candidate.
        </p>
        <Link
          href="/#waitlist"
          className="mt-7 inline-flex h-11 items-center gap-2 rounded-full border border-white/60 bg-white/40 px-5 text-sm font-semibold text-[#10141d] shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/60"
        >
          Join the waitlist
          <ArrowRight size={16} />
        </Link>
      </div>

      <div className="grid gap-4 rounded-[30px] border border-white/60 bg-white/30 p-4 shadow-[0_24px_80px_rgba(20,28,58,0.12)] sm:p-5 md:grid-cols-[0.76fr_1.24fr]">
        <IntegrityDocument />

        <div className="space-y-3">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#384253]">
              <Sparkles size={16} className="text-[#5661d8]" />
              Integrity receipt
            </p>
            <span className="rounded-full border border-[#bdeedc] bg-[#ecfdf5]/75 px-3 py-1 text-[11px] font-semibold text-[#047857]">
              Resume-safe
            </span>
          </div>

          {integrityChecks.map((check, index) => {
            const Icon = check.icon;
            return (
              <motion.div
                key={check.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08, duration: 0.42 }}
                className="relative overflow-hidden rounded-2xl border border-white/60 bg-white/40 p-4"
              >
                <div className="flex items-start gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/50 shadow-sm ring-1 ring-[#dfe3ff] ${check.tone}`}>
                    <Icon size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#10141d]">{check.title}</p>
                      <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${check.tone}`}>
                        {check.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#465166]">{check.copy}</p>
                  </div>
                </div>
                <motion.div
                  className={`absolute inset-x-0 bottom-0 h-1 ${check.bar}`}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.18 + index * 0.08, duration: 0.6 }}
                  style={{ transformOrigin: "left" }}
                />
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProductSafeguardStrip() {
  return (
    <div className="overflow-hidden rounded-[32px] border border-white/60 bg-white/25 p-5 shadow-[0_28px_90px_rgba(86,97,216,0.14)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40 sm:p-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#5661d8]">
            <BadgeCheck size={17} />
            Built for trust
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold text-[#10141d] sm:text-4xl">
            The original resume stays in control.
          </h2>
        </div>
        <span className="text-xs font-medium text-[#465166]">Product safeguards, not marketing claims</span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {productSafeguards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="rounded-2xl border border-white/60 bg-white/30 p-4">
              <Icon size={18} className={item.tone} />
              <p className="mt-4 text-base font-semibold text-[#10141d]">{item.title}</p>
              <p className="mt-1 text-sm leading-6 text-[#465166]">{item.copy}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrustCounter({ value, label }: Readonly<{ value: string; label: string }>) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="min-w-[128px] rounded-2xl border border-white/60 bg-white/30 p-4 shadow-sm"
    >
      <p className="text-3xl font-semibold leading-none text-[#10141d]">{value}</p>
      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#465166]">{label}</p>
    </motion.div>
  );
}

function IntegrityDocument() {
  return (
    <div className="relative min-h-[320px] overflow-hidden rounded-[24px] border border-white/60 bg-white/50 p-5 shadow-[0_20px_60px_rgba(20,28,58,0.10)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-[#5661d8]" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5661d8]">Source resume</p>
          <p className="mt-1 text-base font-semibold text-[#10141d]">Evidence map</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/50 text-[#5661d8] shadow-sm ring-1 ring-[#dfe3ff]">
          <FileCheck2 size={17} />
        </span>
      </div>

      <div className="mt-7 space-y-5">
        {[
          { label: "Experience", widths: ["w-11/12", "w-8/12"] },
          { label: "Projects", widths: ["w-10/12", "w-9/12", "w-7/12"] },
          { label: "Skills", widths: ["w-11/12", "w-8/12"] }
        ].map((section, sectionIndex) => (
          <div key={section.label}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#596579]">{section.label}</p>
            <div className="space-y-2">
              {section.widths.map((width, lineIndex) => (
                <motion.div
                  key={`${section.label}-${width}`}
                  className={`h-2 rounded-full bg-[#dfe3ff] ${width}`}
                  initial={{ scaleX: 0.45, opacity: 0.5 }}
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

      <div className="absolute bottom-5 left-5 right-5 flex items-center gap-2 rounded-xl border border-[#bdeedc] bg-[#ecfdf5]/70 px-3 py-2 text-xs font-semibold text-[#047857]">
        <CheckCircle2 size={15} />
        Evidence attached
      </div>
    </div>
  );
}
