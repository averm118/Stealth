"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { motion, useMotionValueEvent, useScroll } from "framer-motion";
import { ArrowLeft, BarChart3, BookmarkCheck, Mail, Radar, Settings, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingOrbs, PageTransition } from "@/components/motion-primitives";
import { AuthStatus } from "@/components/auth-status";

const navItems = [
  { href: "/dashboard", label: "Radar", icon: BarChart3 },
  { href: "/profile", label: "Resume", icon: UserRound },
  { href: "/saved", label: "Tracker", icon: BookmarkCheck },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const isLandingPage = pathname === "/";
  const isOwnerPage = pathname === "/owner" || pathname === "/auth";
  const showProductNavigation = !isLandingPage && !isOwnerPage;
  const { scrollY } = useScroll();
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);

  useMotionValueEvent(scrollY, "change", (latest) => {
    const scrolled = latest > 18;
    setIsHeaderScrolled((current) => (current === scrolled ? current : scrolled));
  });

  return (
    <div className="min-h-screen">
      {!isLandingPage ? <FloatingOrbs /> : null}
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[620px] terminal-grid opacity-80" />
      <motion.header
        className={cn(
          "fixed inset-x-0 top-0 z-50 overflow-hidden border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500",
          isHeaderScrolled
            ? "border-white/35 bg-white/15 shadow-[0_18px_54px_rgba(30,42,96,0.10)] backdrop-blur-2xl supports-[backdrop-filter]:bg-white/10"
            : "border-transparent bg-transparent shadow-none backdrop-blur-none"
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity duration-500",
            isHeaderScrolled ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="absolute inset-0 bg-[linear-gradient(112deg,rgba(255,255,255,0.24),rgba(255,255,255,0.08)_48%,rgba(226,233,255,0.18))]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(86,97,216,0.08),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(20,184,166,0.06),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.02))]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
        </div>
        <div className="relative mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <motion.span
              whileHover={{ rotate: 8, scale: 1.04 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.06] bg-white text-[#5661d8] shadow-[0_16px_40px_rgba(86,97,216,0.12)]"
            >
              <Radar size={21} />
            </motion.span>
            <span>
              <span className="block text-sm font-semibold tracking-[0.24em] text-[#171b24]">STEALTH</span>
              <span className={cn("block text-xs", isLandingPage ? "font-medium text-[#4f596b]" : "text-[#7a828f]")}>
                AI Internship Radar
              </span>
            </span>
          </Link>
          {showProductNavigation ? (
            <nav className="hidden items-center gap-1 rounded-full border border-black/[0.06] bg-white/66 p-1 shadow-sm backdrop-blur-xl md:flex">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[#737b88] transition hover:text-[#171b24]",
                      active && "text-[#171b24]"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-full bg-[#f1f3f8] shadow-sm"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative flex items-center gap-2">
                      <Icon size={16} />
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>
          ) : null}
          {isLandingPage ? (
            <Link
              href="/#waitlist"
              aria-label="Join the waitlist"
              className="flex h-11 w-11 items-center justify-center gap-2 rounded-full bg-[#171b24] text-sm font-semibold text-white shadow-[0_18px_40px_rgba(20,25,34,0.16)] transition hover:-translate-y-0.5 hover:bg-[#262c37] sm:h-auto sm:w-auto sm:px-5 sm:py-3"
            >
              <Mail size={16} />
              <span className="hidden sm:inline">Join waitlist</span>
            </Link>
          ) : isOwnerPage ? (
            <Link
              href="/"
              aria-label="Return to the landing page"
              className="flex h-11 w-11 items-center justify-center gap-2 rounded-full border border-white/60 bg-white/45 text-sm font-semibold text-[#171b24] shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/65 sm:h-auto sm:w-auto sm:px-5 sm:py-3"
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Landing page</span>
            </Link>
          ) : (
            <AuthStatus />
          )}
        </div>
      </motion.header>
      <main
        className={cn(
          "relative z-10",
          isLandingPage ? "px-0 py-0" : "mx-auto max-w-7xl px-4 pb-8 pt-28 sm:px-6 lg:px-8"
        )}
      >
        <PageTransition key={pathname}>{children}</PageTransition>
      </main>
      {showProductNavigation ? (
        <nav className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-4 gap-1 rounded-full border border-black/[0.06] bg-white/85 p-1 shadow-[0_18px_50px_rgba(20,25,34,0.12)] backdrop-blur-xl md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-full px-2 py-2 text-[11px] text-[#7a828f]",
                  active && "bg-[#f1f3f8] text-[#5661d8]"
                )}
              >
                <Icon size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
