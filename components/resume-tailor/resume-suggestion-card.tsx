import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ResumeSuggestionCardProps = {
  title: string;
  children: ReactNode;
  muted?: boolean;
};

export function ResumeSuggestionCard({ title, children, muted = false }: Readonly<ResumeSuggestionCardProps>) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-black/[0.06] bg-white/70 p-5 shadow-sm",
        muted && "bg-white/50"
      )}
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#9aa1ad]">{title}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}
