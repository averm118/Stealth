import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { CandidateProfile } from "@/lib/types";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ profile: null, source: "local" });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("candidate_profiles")
    .select("profile,resume_file_metadata")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    profile: data?.profile ? { ...data.profile, resumeDocument: data.resume_file_metadata ?? data.profile.resumeDocument ?? null } : null,
    source: data ? "supabase" : "default"
  });
}

export async function PUT(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json()) as { profile?: CandidateProfile };
  if (!body.profile) return NextResponse.json({ error: "Profile is required" }, { status: 400 });

  const { error } = await supabase.from("candidate_profiles").upsert({
    user_id: user.id,
    profile: body.profile,
    resume_text: body.profile.resumeText ?? "",
    resume_file_metadata: body.profile.resumeDocument ?? null
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
