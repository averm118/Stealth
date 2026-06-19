"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { BriefcaseBusiness, FileStack, Layers3 } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandGroup = "employer" | "source" | "format";

type BrandMark = {
  name: string;
  src: string;
  group: BrandGroup;
  alt: string;
  disclaimer?: string;
  imageClassName?: string;
};

const employers: BrandMark[] = [
  brand("Tesla", "/brand-logos/employers/tesla.svg", "employer"),
  brand("Amazon", "/brand-logos/employers/amazon.svg", "employer", "max-h-7"),
  brand("Microsoft", "/brand-logos/employers/microsoft.svg", "employer", "max-h-7"),
  brand("Honeywell", "/brand-logos/employers/honeywell.svg", "employer", "max-h-6"),
  brand("Intel", "/brand-logos/employers/intel.svg", "employer"),
  brand("Adobe", "/brand-logos/employers/adobe.svg", "employer", "max-h-7"),
  brand("Deloitte", "/brand-logos/employers/deloitte.svg", "employer", "max-h-6"),
  brand("Target", "/brand-logos/employers/target.svg", "employer"),
  brand("Boeing", "/brand-logos/employers/boeing.svg", "employer"),
  brand("Uber", "/brand-logos/employers/uber.svg", "employer"),
  brand("Walmart", "/brand-logos/employers/walmart.svg", "employer", "max-h-7"),
  brand("FedEx", "/brand-logos/employers/fedex.svg", "employer"),
  brand("Notion", "/brand-logos/employers/notion.svg", "employer"),
  brand("ServiceNow", "/brand-logos/employers/servicenow.svg", "employer", "max-h-6"),
  brand("Snowflake", "/brand-logos/employers/snowflake.svg", "employer"),
  brand("Databricks", "/brand-logos/employers/databricks.svg", "employer"),
  brand("Robinhood", "/brand-logos/employers/robinhood.svg", "employer"),
  brand("ASML", "/brand-logos/employers/asml.svg", "employer", "max-h-6"),
  brand("Scale AI", "/brand-logos/employers/scale-ai.svg", "employer", "max-h-7"),
  brand("American Express", "/brand-logos/employers/american-express.svg", "employer"),
  brand("Caterpillar", "/brand-logos/employers/caterpillar.svg", "employer"),
  brand("Waymo", "/brand-logos/employers/waymo.svg", "employer")
];

const jobSources: BrandMark[] = [
  brand("Greenhouse", "/brand-logos/sources/greenhouse.svg", "source"),
  brand("Lever", "/brand-logos/sources/lever.png", "source", "max-h-6"),
  brand("Ashby", "/brand-logos/sources/ashby.png", "source"),
  brand("Workday", "/brand-logos/sources/workday.svg", "source", "max-h-7")
];

const formats: BrandMark[] = [
  brand("Word / DOCX", "/brand-logos/formats/microsoft-word.svg", "format"),
  brand("Adobe PDF", "/brand-logos/formats/adobe-pdf.svg", "format"),
  brand("Markdown", "/brand-logos/formats/markdown.svg", "format"),
  brand("Plain text", "/brand-logos/formats/plain-text.svg", "format")
];

function brand(name: string, src: string, group: BrandGroup, imageClassName?: string): BrandMark {
  return {
    name,
    src,
    group,
    alt: `${name} logo`,
    imageClassName,
    disclaimer: group === "employer" ? "Catalog coverage only" : undefined
  };
}

function LogoTile({
  mark,
  compact = false,
  showName = true
}: Readonly<{
  mark: BrandMark;
  compact?: boolean;
  showName?: boolean;
}>) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center border border-white/70 bg-white/45 shadow-[0_12px_36px_rgba(30,42,96,0.10)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/35",
        compact ? "h-14 w-[150px] gap-3 rounded-2xl px-3" : "h-[78px] w-[178px] flex-col justify-center gap-2 rounded-[22px] px-4"
      )}
    >
      <div className={cn("relative shrink-0", compact ? "h-7 w-9" : "h-8 w-28")}>
        <Image
          src={mark.src}
          alt={mark.alt}
          fill
          unoptimized
          sizes={compact ? "36px" : "112px"}
          className={cn("object-contain", mark.imageClassName)}
        />
      </div>
      {showName ? (
        <span className={cn("truncate font-semibold text-[#283142]", compact ? "text-xs" : "max-w-full text-[11px]")}>
          {mark.name}
        </span>
      ) : null}
    </div>
  );
}

function StaticLogoRow({ marks }: Readonly<{ marks: BrandMark[] }>) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {marks.map((mark) => (
        <LogoTile key={mark.name} mark={mark} />
      ))}
    </div>
  );
}

function MovingLogoRow({
  marks,
  reverse = false,
  duration
}: Readonly<{
  marks: BrandMark[];
  reverse?: boolean;
  duration: number;
}>) {
  return (
    <motion.div
      className="flex w-max"
      initial={{ x: reverse ? "-50%" : "0%" }}
      animate={{ x: reverse ? ["-50%", "0%"] : ["0%", "-50%"] }}
      transition={{ duration, ease: "linear", repeat: Infinity }}
    >
      {[0, 1].map((copy) => (
        <div key={copy} className="flex shrink-0 gap-3 pr-3" aria-hidden={copy === 1}>
          {marks.map((mark) => (
            <LogoTile key={`${copy}-${mark.name}`} mark={mark} />
          ))}
        </div>
      ))}
    </motion.div>
  );
}

export function EmployerBrandWall() {
  const reduceMotion = useReducedMotion();
  const firstRow = employers.slice(0, 11);
  const secondRow = employers.slice(11);

  return (
    <div className="overflow-hidden rounded-[36px] border border-white/65 bg-white/24 py-7 shadow-[0_34px_110px_rgba(30,42,96,0.16)] backdrop-blur-xl ring-1 ring-[#dfe3ff]/40 sm:py-9">
      <div className="flex flex-col gap-4 px-5 sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#5661d8]">
            <BriefcaseBusiness size={16} />
            Employer catalog
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold text-[#10141d] sm:text-4xl">
            Roles across teams you already know.
          </h2>
        </div>
        <p className="max-w-sm text-sm font-medium leading-6 text-[#4f5b6f]">22 represented employers across the current catalog.</p>
      </div>

      <div className="mt-7 space-y-3 overflow-hidden px-3 [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)] sm:px-0">
        {reduceMotion ? (
          <>
            <StaticLogoRow marks={firstRow} />
            <StaticLogoRow marks={secondRow} />
          </>
        ) : (
          <>
            <MovingLogoRow marks={firstRow} duration={42} />
            <MovingLogoRow marks={secondRow} reverse duration={46} />
          </>
        )}
      </div>

      <p className="mt-6 px-5 text-xs font-medium text-[#626d7e] sm:px-8">
        Company logos represent catalog coverage, not partnerships or endorsements.
      </p>
    </div>
  );
}

export function JobSourceBanner() {
  return (
    <div className="border-t border-[#dfe3ff]/80 bg-white/24 p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="shrink-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#384253]">
            <Layers3 size={16} className="text-[#0f766e]" />
            Public job source layer
          </p>
          <p className="mt-1 text-xs font-medium text-[#687180]">No partnership implied</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {jobSources.map((mark) => (
            <LogoTile key={mark.name} mark={mark} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ResumeFormatBanner() {
  return (
    <div className="border-b border-[#dfe3ff] bg-white/24 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-[#384253]">
        <FileStack size={16} className="text-[#5661d8]" />
        Upload and export formats
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {formats.map((mark, index) => (
          <motion.div
            key={mark.name}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: index * 0.07, duration: 0.4 }}
          >
            <LogoTile mark={mark} compact />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
