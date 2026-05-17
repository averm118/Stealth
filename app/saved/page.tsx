"use client";

import Link from "next/link";
import { BookmarkCheck, Inbox, Trash2 } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { ScoreRing } from "@/components/score-ring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { jobs } from "@/data/jobs";
import { scoreJob } from "@/lib/scoring";
import { SavedStatus } from "@/lib/types";
import { Reveal, Stagger, StaggerItem } from "@/components/motion-primitives";

const statuses: SavedStatus[] = ["saved", "applied", "interview", "rejected", "offer"];

export default function SavedPage() {
  const { profile, savedJobs, setJobStatus, removeSavedJob } = useAppState();
  const tracked = jobs.filter((job) => savedJobs[job.id]);

  return (
    <div className="pb-24">
      <Reveal>
      <Card className="mb-6 p-7">
        <p className="flex items-center gap-2 text-sm font-medium text-[#5661d8]">
          <BookmarkCheck size={16} />
          Saved jobs tracker
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-[-0.05em] text-[#171b24]">Application pipeline</h1>
        <p className="mt-3 text-sm text-[#687180]">Statuses persist in localStorage until Supabase auth and tables are connected.</p>
      </Card>
      </Reveal>
      {tracked.length === 0 ? (
        <Reveal>
        <Card className="grid min-h-[420px] place-items-center p-8 text-center">
          <div>
            <Inbox className="mx-auto text-[#5661d8]" size={42} />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-[#171b24]">No roles saved yet</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#687180]">Save high-fit jobs from the radar to build your internship pipeline.</p>
            <Button asChild className="mt-6">
              <Link href="/dashboard">Browse radar</Link>
            </Button>
          </div>
        </Card>
        </Reveal>
      ) : (
        <Stagger className="space-y-3">
          {tracked.map((job) => {
            const match = scoreJob(job, profile);
            return (
              <StaggerItem key={job.id}>
              <Card className="p-5">
                <div className="grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-center">
                  <ScoreRing score={match.score} size="sm" />
                  <div>
                    <Link href={`/jobs/${job.id}`} className="text-lg font-semibold text-[#171b24] hover:text-[#5661d8]">{job.title}</Link>
                    <p className="mt-1 text-sm text-[#687180]">{job.company} / {job.location} / {job.workType}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {job.skills.slice(0, 4).map((skill) => <Badge key={skill}>{skill}</Badge>)}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                    <select
                      value={savedJobs[job.id]}
                      onChange={(event) => setJobStatus(job.id, event.target.value as SavedStatus)}
                      className="h-10 rounded-full border border-black/[0.07] bg-white px-4 text-sm capitalize text-[#171b24] shadow-sm outline-none"
                    >
                      {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <Button variant="ghost" size="icon" aria-label="Remove saved job" onClick={() => removeSavedJob(job.id)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
