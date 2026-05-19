"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserConfig } from "@/lib/supabase/config";

let browserClient: SupabaseClient | null = null;

export function createBrowserSupabaseClient() {
  const config = getSupabaseBrowserConfig();

  if (!config) {
    return null;
  }

  browserClient ??= createBrowserClient(config.url, config.anonKey);
  return browserClient;
}
