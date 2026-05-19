import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerConfig } from "@/lib/supabase/config";

export async function createServerSupabaseClient() {
  const config = getSupabaseServerConfig();

  if (!config.url || !config.anonKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies; middleware refreshes the session instead.
        }
      }
    }
  });
}

export function createServiceRoleSupabaseClient() {
  const config = getSupabaseServerConfig();

  if (!config.url || !config.serviceRoleKey) {
    return null;
  }

  // Use this only inside trusted server routes/jobs. Never expose the service role key to the browser.
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}
