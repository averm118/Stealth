import { NextResponse } from "next/server";
import { getJobs, getJobsMetadata } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit"));
  const jobs = await getJobs({
    role: url.searchParams.get("role") ?? undefined,
    workType: url.searchParams.get("workType") ?? undefined,
    sponsorship: url.searchParams.get("sponsorship") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined
  });
  const metadata = await getJobsMetadata();

  return NextResponse.json({
    jobs,
    count: jobs.length,
    totalCatalogCount: metadata.count,
    lastImportedAt: metadata.lastImportedAt
  });
}
