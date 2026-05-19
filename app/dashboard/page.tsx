import { JobBoard } from "@/components/job-board";
import { getJobs, getJobsMetadata } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [jobs, metadata] = await Promise.all([getJobs(), getJobsMetadata()]);

  return (
    <div className="pb-24">
      <JobBoard jobs={jobs} metadata={metadata} />
    </div>
  );
}
