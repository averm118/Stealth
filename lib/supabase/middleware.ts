import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAdminEmail } from "@/lib/auth/admin";
import { getSupabaseBrowserConfig } from "@/lib/supabase/config";

const publicPages = new Set(["/", "/owner", "/auth", "/auth/callback"]);
const publicApiRoutes = new Set(["/api/waitlist"]);
const machineApiRoutes = new Set(["/api/jobs/ingest", "/api/jobs/import-scraped"]);

export async function updateSession(request: NextRequest) {
  const config = getSupabaseBrowserConfig();
  const pathname = request.nextUrl.pathname;

  if (!config) {
    return handleAccess(request, NextResponse.next({ request }), null, pathname);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return handleAccess(request, response, user?.email ?? null, pathname);
}

function handleAccess(request: NextRequest, response: NextResponse, userEmail: string | null, pathname: string) {
  if (pathname === "/auth") {
    const url = request.nextUrl.clone();
    url.pathname = "/owner";
    url.search = "";
    return copyCookies(response, NextResponse.redirect(url));
  }

  const isAdmin = isAdminEmail(userEmail);

  if (pathname === "/owner" && isAdmin) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return copyCookies(response, NextResponse.redirect(url));
  }

  if (publicPages.has(pathname) || publicApiRoutes.has(pathname) || machineApiRoutes.has(pathname)) {
    return response;
  }

  if (pathname.startsWith("/api/")) {
    if (!userEmail) {
      return copyCookies(
        response,
        NextResponse.json({ error: "Authentication required." }, { status: 401 })
      );
    }

    if (!isAdmin) {
      return copyCookies(
        response,
        NextResponse.json({ error: "Owner access required." }, { status: 403 })
      );
    }

    return response;
  }

  if (!isAdmin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    url.hash = "waitlist";
    return copyCookies(response, NextResponse.redirect(url));
  }

  return response;
}

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}
