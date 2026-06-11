"use client";

import { useEffect, useMemo, useState } from "react";
import { getCompanyInitials, getCompanyLogoUrls } from "@/lib/company-logos";
import { cn } from "@/lib/utils";

type CompanyLogoProps = {
  company: string;
  className?: string;
  markClassName?: string;
};

export function CompanyLogo({ company, className, markClassName }: Readonly<CompanyLogoProps>) {
  const [logoIndex, setLogoIndex] = useState(0);
  const logoUrls = useMemo(() => getCompanyLogoUrls(company), [company]);
  const logoUrl = logoUrls[logoIndex];
  const initials = getCompanyInitials(company);
  const theme = getLogoTheme(company);

  useEffect(() => {
    setLogoIndex(0);
  }, [company]);

  return (
    <div
      className={cn(
        "grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/80 bg-white/88 shadow-[0_18px_44px_rgba(20,25,34,0.10)] ring-1 ring-black/[0.04]",
        className
      )}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${company} logo`}
          className={cn("max-h-[70%] max-w-[76%] object-contain drop-shadow-[0_8px_18px_rgba(20,25,34,0.14)]", markClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setLogoIndex((index) => index + 1)}
        />
      ) : (
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold shadow-inner ring-1 ring-white/70",
            theme
          )}
        >
          {initials}
        </span>
      )}
    </div>
  );
}

function getLogoTheme(company: string) {
  const themes = [
    "bg-[#eef2ff] text-[#4f46e5]",
    "bg-[#ecfeff] text-[#0e7490]",
    "bg-[#f0fdf4] text-[#15803d]",
    "bg-[#fff7ed] text-[#c2410c]",
    "bg-[#fdf2f8] text-[#be185d]",
    "bg-[#f8fafc] text-[#475569]"
  ];
  const index = company.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % themes.length;
  return themes[index];
}
