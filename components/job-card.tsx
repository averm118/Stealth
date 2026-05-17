"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bookmark, Building2, ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScoreRing } from "@/components/score-ring";
import { useAppState } from "@/components/app-state";
import { scoreJob } from "@/lib/scoring";
import { formatDate } from "@/lib/utils";
import { Job } from "@/lib/types";

export function JobCard({ job }: Readonly<{ job: Job }>) {
  const { profile, savedJobs, setJobStatus } = useAppState();
  const match = scoreJob(job, profile);
  const saved = Boolean(savedJobs[job.id]);

  return (
    <motion.div
      whileHover={{ y: -8, scale: 1.01 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
    <Card className="group p-5 transition duration-300 hover:border-[#bdc5ff] hover:shadow-[0_30px_80px_rgba(86,97,216,0.13)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#858d9a]">
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#f2f4fb] text-[10px] font-semibold text-[#5661d8]">
                {job.company.slice(0, 2).toUpperCase()}
              </span>
              <Building2 size={13} />{job.company}
            </span>
            <span className="h-1 w-1 rounded-full bg-[#c9ced8]" />
            <span>Posted {formatDate(job.postedDate)}</span>
          </div>
          <Link href={`/jobs/${job.id}`} className="mt-4 block text-xl font-semibold text-[#171b24] transition hover:text-[#5661d8]">
            {job.title}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#687180]">
            <span className="flex items-center gap-1"><MapPin size={14} />{job.location}</span>
            <span>{job.workType}</span>
          </div>
        </div>
        <ScoreRing score={match.score} size="sm" />
      </div>
      <p className="mt-5 line-clamp-2 text-sm leading-6 text-[#687180]">{job.description}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {job.skills.slice(0, 5).map((skill) => (
          <Badge key={skill}>{skill}</Badge>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/jobs/${job.id}`}>
            View Match
            <ExternalLink size={15} />
          </Link>
        </Button>
        <Button
          variant={saved ? "default" : "outline"}
          size="icon"
          aria-label={saved ? "Saved" : "Save job"}
          onClick={() => setJobStatus(job.id, "saved")}
        >
          <motion.span animate={saved ? { scale: [1, 1.22, 1], rotate: [0, -10, 0] } : { scale: 1 }}>
            <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
          </motion.span>
        </Button>
      </div>
    </Card>
    </motion.div>
  );
}
