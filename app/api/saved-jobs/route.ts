import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { SavedStatus } from "@/lib/types";

const statuses: SavedStatus[] = ["saved", "applied", "interview", "rejected", "offer"];

export async function GET() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ savedJobs: {}, source: "local" });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("saved_jobs")
    .select("job_id,status")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const savedJobs = Object.fromEntries((data ?? []).map((item) => [item.job_id, item.status]));
  return NextResponse.json({ savedJobs, source: "supabase" });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as { jobId?: string; status?: SavedStatus };
  const status = body.status ?? "saved";

  if (!body.jobId) return NextResponse.json({ error: "Job id is required" }, { status: 400 });
  if (!statuses.includes(status)) return NextResponse.json({ error: "Invalid saved job status" }, { status: 400 });

  const { error } = await supabase.from("saved_jobs").upsert({
    user_id: user.id,
    job_id: body.jobId,
    status
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ error: "Job id is required" }, { status: 400 });

  const { error } = await supabase
    .from("saved_jobs")
    .delete()
    .eq("user_id", user.id)
    .eq("job_id", body.jobId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
