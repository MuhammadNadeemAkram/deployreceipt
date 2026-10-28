"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";
import type { Database } from "./types";

export function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");
  return createBrowserClient<Database>(config.url, config.key);
}
