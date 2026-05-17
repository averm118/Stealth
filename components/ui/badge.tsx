import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Badge({
  children,
  className
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <span className={cn("inline-flex items-center rounded-full border border-black/[0.07] bg-white/65 px-2.5 py-1 text-xs font-medium text-[#626a78] shadow-sm", className)}>
      {children}
    </span>
  );
}
