export function getAdminEmails() {
  return new Set(
    (process.env.STEALTH_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return getAdminEmails().has(email.trim().toLowerCase());
}
