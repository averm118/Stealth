"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, BookmarkCheck, BrainCircuit, BriefcaseBusiness, FileText, Gauge, Globe2, Radar, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnimatedCounter, Reveal, Stagger, StaggerItem, TiltPanel } from "@/components/motion-primitives";
import { jobs } from "@/data/jobs";

const productSections = [
  {
    eyebrow: "Resume intelligence",
    title: "Read the resume as a career map.",
    copy: "Upload a PDF or DOCX and Stealth extracts education, target roles, experience focus, sponsorship needs, and search intent into a clean candidate profile.",
    icon: FileText
  },
  {
    eyebrow: "Resume radar",
    title: "Role-first matching without noisy skill overlap.",
    copy: "The dashboard prioritizes role direction, degree fit, looking-for preference, sponsorship signals, and freshness so broad tools do not hijack your results.",
    icon: Gauge
  },
  {
    eyebrow: "Application tools",
    title: "Tailor the next step from one job page.",
    copy: "Open any role for a deeper compatibility brief, tailored resume draft, and human-sounding cover letter grounded in your uploaded resume.",
    icon: BookmarkCheck
  },
  {
    eyebrow: "Sponsorship insights",
    title: "Visa-aware ranking from the start.",
    copy: "International student signals prioritize roles and companies that look more sponsorship-friendly for CPT, OPT, and beyond.",
    icon: Globe2
  }
];

export default function LandingPage() {
  return (
    <div className="overflow-hidden pb-28">
      <section className="relative min-h-[78vh] py-16 sm:py-24">
        <motion.div
          className="absolute left-1/2 top-10 h-56 w-56 -translate-x-1/2 rounded-full bg-[#dfe5ff] opacity-50 blur-3xl"
          animate={{ scale: [1, 1.18, 1], y: [0, 28, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="relative mx-auto max-w-5xl text-center">
          <Reveal>
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/70 px-4 py-2 text-sm text-[#687180] shadow-sm backdrop-blur">
              <Sparkles size={15} className="text-[#5661d8]" />
              Resume-first internship radar for students
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mx-auto mt-8 max-w-5xl text-balance text-6xl font-semibold leading-[0.94] tracking-[-0.055em] text-[#11141b] sm:text-7xl lg:text-8xl">
              Find the roles that already fit you.
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-[#687180]">
              Stealth turns your resume into a quiet command center for internships and new-grad roles: matched openings, sharper materials, and a calmer application flow.
            </p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open radar
                  <ArrowRight size={18} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/profile">Upload Resume</Link>
              </Button>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.32} className="relative mx-auto mt-16 max-w-6xl">
          <TiltPanel className="relative rounded-[42px] border border-black/[0.06] bg-white/78 p-4 shadow-[0_44px_120px_rgba(20,25,34,0.12)] backdrop-blur-xl">
            <div className="absolute -left-10 top-16 hidden rounded-3xl border border-black/[0.06] bg-white/85 p-4 shadow-[0_24px_70px_rgba(20,25,34,0.12)] lg:block">
              <p className="text-xs uppercase tracking-[0.18em] text-[#9aa1ad]">Student-first</p>
              <p className="mt-2 text-3xl font-semibold text-[#171b24]">50+</p>
            </div>
            <div className="absolute -right-12 bottom-16 hidden rounded-3xl border border-black/[0.06] bg-white/85 p-4 shadow-[0_24px_70px_rgba(20,25,34,0.12)] lg:block">
              <p className="text-xs uppercase tracking-[0.18em] text-[#9aa1ad]">Sponsor signal</p>
              <p className="mt-2 text-3xl font-semibold text-[#5661d8]">High</p>
            </div>
            <DashboardMockup />
          </TiltPanel>
        </Reveal>
      </section>

      <Stagger className="grid gap-4 py-10 md:grid-cols-3">
        {[
          { label: "Open roles", value: jobs.length, suffix: "+" },
          { label: "Profile signals", value: 12, suffix: "+" },
          { label: "Career tools", value: 3, suffix: "" }
        ].map((metric) => (
          <StaggerItem key={metric.label}>
            <Card className="p-8 text-center">
              <p className="text-5xl font-semibold tracking-[-0.05em] text-[#171b24]">
                <AnimatedCounter value={metric.value} suffix={metric.suffix} />
              </p>
              <p className="mt-3 text-sm text-[#7a828f]">{metric.label}</p>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      <div className="space-y-24 py-16">
        {productSections.map((section, index) => {
          const Icon = section.icon;
          const reversed = index % 2 === 1;
          return (
            <section key={section.title} className={`grid items-center gap-10 lg:grid-cols-2 ${reversed ? "lg:[&>*:first-child]:order-2" : ""}`}>
              <Reveal>
                <div className="max-w-xl">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5661d8]">
                    <Icon size={20} />
                  </div>
                  <p className="mt-7 text-sm font-medium uppercase tracking-[0.18em] text-[#8c94a3]">{section.eyebrow}</p>
                  <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.04em] text-[#171b24] sm:text-5xl">{section.title}</h2>
                  <p className="mt-5 text-lg leading-8 text-[#687180]">{section.copy}</p>
                </div>
              </Reveal>
              <Reveal delay={0.12}>
                <FeatureMockup index={index} />
              </Reveal>
            </section>
          );
        })}
      </div>

      <Reveal className="py-16">
        <div className="relative overflow-hidden rounded-[42px] border border-black/[0.06] bg-[#151922] px-6 py-16 text-center shadow-[0_44px_120px_rgba(20,25,34,0.18)] sm:px-10">
          <motion.div
            className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-[#7e8cff] opacity-20 blur-3xl"
            animate={{ scale: [1, 1.2, 1], x: [-20, 20, -20] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="relative">
            <p className="text-sm uppercase tracking-[0.22em] text-white/45">Ready radar</p>
            <h2 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">
              Replace career chaos with a calmer signal.
            </h2>
            <div className="mt-8 flex justify-center">
              <Button asChild variant="secondary" size="lg">
                <Link href="/profile">
                  Start with your resume
                  <ArrowRight size={18} />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

function DashboardMockup() {
  return (
    <div className="rounded-[32px] bg-[#f8f8fb] p-5">
      <div className="grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="rounded-[26px] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#eef1ff] text-[#5661d8]"><Radar size={18} /></span>
            <div>
              <p className="text-sm font-semibold text-[#171b24]">Candidate signal</p>
              <p className="text-xs text-[#858d9a]">Resume parsed</p>
            </div>
          </div>
          <div className="mt-8 space-y-3">
            {["Target role", "Degree fit", "Sponsorship", "Freshness"].map((label, index) => (
              <motion.div
                key={label}
                className="h-2 rounded-full bg-[#eef0f5]"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: index * 0.08 }}
                style={{ transformOrigin: "left" }}
              >
                <div className="h-full rounded-full bg-[#8b96ff]" style={{ width: `${84 - index * 11}%` }} />
              </motion.div>
            ))}
          </div>
        </div>
        <div className="rounded-[26px] bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm font-semibold text-[#171b24]">Resume radar</p>
            <BrainCircuit size={18} className="text-[#5661d8]" />
          </div>
          <div className="space-y-3">
            {jobs.slice(0, 4).map((job, index) => (
              <motion.div
                key={job.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-black/[0.05] bg-[#fbfbfd] p-4"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.15 + index * 0.08 }}
              >
                <div>
                  <p className="text-sm font-medium text-[#171b24]">{job.title}</p>
                  <p className="mt-1 text-xs text-[#858d9a]">{job.company} / {job.workType}</p>
                </div>
                <span className="rounded-full bg-[#eef1ff] px-3 py-1 text-xs font-semibold text-[#5661d8]">
                  Match
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureMockup({ index }: Readonly<{ index: number }>) {
  return (
    <Card className="relative min-h-[360px] overflow-hidden p-7">
      <motion.div
        className="absolute right-10 top-10 h-36 w-36 rounded-full bg-[#e1e7ff] blur-3xl"
        animate={{ scale: [1, 1.22, 1], opacity: [0.45, 0.72, 0.45] }}
        transition={{ duration: 8 + index, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative space-y-4">
        {Array.from({ length: 4 }).map((_, row) => (
          <motion.div
            key={row}
            className="rounded-3xl border border-black/[0.05] bg-white/75 p-4 shadow-sm"
            initial={{ opacity: 0, x: index % 2 ? 22 : -22 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: row * 0.08, duration: 0.55 }}
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-36 rounded-full bg-[#e8ebf2]" />
              <div className="h-7 w-7 rounded-full bg-[#eef1ff]" />
            </div>
            <div className="mt-4 h-2 rounded-full bg-[#f0f1f5]">
              <div className="h-full rounded-full bg-[#8b96ff]" style={{ width: `${48 + row * 12}%` }} />
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}
