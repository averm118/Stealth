export function getSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function getSupabaseServerConfig() {
  const browserConfig = getSupabaseBrowserConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!browserConfig) {
    return { url: undefined, anonKey: undefined, serviceRoleKey };
  }

  return {
    ...browserConfig,
    serviceRoleKey,
  };
}
