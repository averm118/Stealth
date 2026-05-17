import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Card({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return <div className={cn("rounded-[28px] border border-black/[0.06] bg-white/78 shadow-[0_24px_70px_rgba(20,25,34,0.08)] backdrop-blur-xl", className)}>{children}</div>;
}
