import { getScoreTone } from "@/lib/scoring";
import type { CSSProperties } from "react";

export function ScoreRing({ score, size = "md" }: Readonly<{ score: number; size?: "sm" | "md" | "lg" }>) {
  const dimensions = size === "lg" ? "h-28 w-28 text-3xl" : size === "sm" ? "h-14 w-14 text-base" : "h-20 w-20 text-2xl";
  return (
    <div
      className={`grid ${dimensions} place-items-center rounded-full border border-black/[0.05] bg-[conic-gradient(from_180deg,#6f7dff_var(--score),rgba(21,25,34,0.08)_0)] p-1 shadow-[0_14px_30px_rgba(111,125,255,0.18)]`}
      style={{ "--score": `${score}%` } as CSSProperties}
    >
      <div className="grid h-full w-full place-items-center rounded-full bg-white">
        <span className={`font-bold ${getScoreTone(score)}`}>{score}</span>
      </div>
    </div>
  );
}
