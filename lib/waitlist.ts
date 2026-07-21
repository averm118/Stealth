const waitlistSuccessMessage = "Thanks for joining the waitlist. We'll email you when Stealth is ready.";

export function getWaitlistSuccessMessage() {
  return waitlistSuccessMessage;
}

export function normalizeWaitlistEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidWaitlistEmail(email: string) {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function sendWaitlistWelcomeEmail(email: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.WAITLIST_FROM_EMAIL?.trim();
  const replyTo = process.env.WAITLIST_REPLY_TO?.trim();

  if (!apiKey || !from) {
    return {
      sent: false,
      error: "Welcome email is not configured."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [email],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: "You're on the Stealth waitlist",
        text: [
          "Thanks for joining the Stealth waitlist.",
          "",
          "Stealth is still in private access. We'll email you when your spot is ready.",
          "",
          "No account has been created yet, and there is nothing else you need to do."
        ].join("\n"),
        html: `
          <div style="margin:0;background:#f4f6ff;padding:40px 20px;font-family:Inter,Arial,sans-serif;color:#111827">
            <div style="margin:0 auto;max-width:560px;border:1px solid #dfe3ff;border-radius:24px;background:#ffffff;padding:36px">
              <p style="margin:0 0 18px;color:#5661d8;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">Stealth waitlist</p>
              <h1 style="margin:0;font-size:32px;line-height:1.15">You're on the list.</h1>
              <p style="margin:20px 0 0;color:#465166;font-size:16px;line-height:1.7">
                Stealth is still in private access. We'll email you when your spot is ready.
              </p>
              <p style="margin:16px 0 0;color:#667186;font-size:14px;line-height:1.6">
                No account has been created yet, and there is nothing else you need to do.
              </p>
            </div>
          </div>
        `
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const responseText = await response.text();
      return {
        sent: false,
        error: `Resend returned ${response.status}: ${responseText.slice(0, 500)}`
      };
    }

    return { sent: true, error: null };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : "Unknown welcome email error."
    };
  } finally {
    clearTimeout(timeout);
  }
}
