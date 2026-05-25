"use client";

import { MailPlus } from "lucide-react";
import { useState } from "react";
import { CoverLetterPanel } from "@/components/cover-letter/cover-letter-panel";
import { Button } from "@/components/ui/button";
import type { CandidateProfile, Job } from "@/lib/types";

type CoverLetterButtonProps = {
  job: Job;
  profile: CandidateProfile;
};

export function CoverLetterButton({ job, profile }: Readonly<CoverLetterButtonProps>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <MailPlus size={16} />
        Create cover letter
      </Button>
      <CoverLetterPanel job={job} profile={profile} open={open} onOpenChange={setOpen} />
    </>
  );
}
