"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TailorResumePanel } from "@/components/resume-tailor/tailor-resume-panel";
import type { CandidateProfile, Job } from "@/lib/types";

type TailorResumeButtonProps = {
  job: Job;
  profile: CandidateProfile;
};

export function TailorResumeButton({ job, profile }: Readonly<TailorResumeButtonProps>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}>
        <Sparkles size={16} />
        Tailor resume
      </Button>
      <TailorResumePanel job={job} profile={profile} open={open} onOpenChange={setOpen} />
    </>
  );
}
