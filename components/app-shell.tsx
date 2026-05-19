"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { BarChart3, BookmarkCheck, Radar, Settings, UserRound } from "lucide-react";
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
  const { scrollY } = useScroll();
  const headerShadow = useTransform(scrollY, [0, 80], ["0 0 0 rgba(20,25,34,0)", "0 18px 46px rgba(20,25,34,0.08)"]);

  return (
    <div className="min-h-screen">
      <FloatingOrbs />
      <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[620px] terminal-grid opacity-80" />
      <motion.header
        style={{ boxShadow: headerShadow }}
        className="sticky top-0 z-50 border-b border-black/[0.05] bg-[#fbfaf7]/72 backdrop-blur-2xl"
      >
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <motion.span
              whileHover={{ rotate: 8, scale: 1.04 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-black/[0.06] bg-white text-[#5661d8] shadow-[0_16px_40px_rgba(86,97,216,0.12)]"
            >
              <Radar size={21} />
            </motion.span>
            <span>
              <span className="block text-sm font-semibold tracking-[0.24em] text-[#171b24]">STEALTH</span>
              <span className="block text-xs text-[#7a828f]">AI Internship Radar</span>
            </span>
          </Link>
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
          <AuthStatus />
        </div>
      </motion.header>
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageTransition key={pathname}>{children}</PageTransition>
      </main>
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
    </div>
  );
}
