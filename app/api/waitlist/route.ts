import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import {
  getWaitlistSuccessMessage,
  isValidWaitlistEmail,
  normalizeWaitlistEmail,
  sendWaitlistWelcomeEmail
} from "@/lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WaitlistBody = {
  email?: unknown;
  website?: unknown;
};

export async function POST(request: Request) {
  const body = await readBody(request);
  const message = getWaitlistSuccessMessage();

  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true, message });
  }

  const email = normalizeWaitlistEmail(body.email);

  if (!isValidWaitlistEmail(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const supabase = createServiceRoleSupabaseClient();

  if (!supabase) {
    console.error("Waitlist submission failed because Supabase service-role access is not configured.");
    return NextResponse.json(
      { ok: false, error: "The waitlist is temporarily unavailable. Please try again shortly." },
      { status: 503 }
    );
  }

  const { data: entry, error: insertError } = await supabase
    .from("waitlist_entries")
    .insert({
      email,
      status: "joined",
      source: "landing_hero"
    })
    .select("id")
    .single();

  if (insertError?.code === "23505") {
    return NextResponse.json({ ok: true, message });
  }

  if (insertError || !entry) {
    console.error("Waitlist insert failed.", insertError);
    return NextResponse.json(
      { ok: false, error: "The waitlist is temporarily unavailable. Please try again shortly." },
      { status: 500 }
    );
  }

  const delivery = await sendWaitlistWelcomeEmail(email);
  const deliveryUpdate = delivery.sent
    ? {
        welcome_email_sent_at: new Date().toISOString(),
        delivery_error: null
      }
    : {
        welcome_email_sent_at: null,
        delivery_error: delivery.error
      };

  const { error: updateError } = await supabase
    .from("waitlist_entries")
    .update(deliveryUpdate)
    .eq("id", entry.id);

  if (updateError) {
    console.error("Waitlist delivery status update failed.", updateError);
  }

  return NextResponse.json({ ok: true, message });
}

async function readBody(request: Request): Promise<WaitlistBody> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as WaitlistBody) : {};
  } catch {
    return {};
  }
}
