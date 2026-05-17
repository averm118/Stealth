export type ResumeSection = {
  title: string;
  content: string;
};

export type StructuredResume = {
  sections: ResumeSection[];
  sectionNames: string[];
  structuredText: string;
};

const sectionAliases: Record<string, string> = {
  summary: "Summary",
  profile: "Summary",
  objective: "Summary",
  education: "Education",
  "academic background": "Education",
  experience: "Experience",
  "work experience": "Experience",
  employment: "Experience",
  projects: "Projects",
  "academic projects": "Projects",
  skills: "Skills",
  "technical skills": "Skills",
  certifications: "Certifications",
  certificates: "Certifications",
  leadership: "Leadership",
  activities: "Leadership",
  awards: "Awards",
  honors: "Awards"
};

export function structureResumeText(rawText: string): StructuredResume {
  const lines = rawText
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sections: ResumeSection[] = [];
  let currentTitle = "Resume Header";
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentLines.length) return;
    sections.push({
      title: currentTitle,
      content: currentLines.join("\n")
    });
    currentLines = [];
  };

  for (const line of lines) {
    const heading = normalizeSectionHeading(line);
    if (heading) {
      flush();
      currentTitle = heading;
      continue;
    }
    currentLines.push(line);
  }

  flush();

  const safeSections =
    sections.length > 0
      ? sections
      : [
          {
            title: "Resume",
            content: rawText.trim()
          }
        ];

  return {
    sections: safeSections,
    sectionNames: safeSections.map((section) => section.title),
    structuredText: safeSections
      .map((section) => `SECTION: ${section.title}\n${section.content}`)
      .join("\n\n")
  };
}

export function buildStructuredResumePromptText({
  fileName,
  fileType,
  structuredResume
}: {
  fileName: string;
  fileType: string;
  structuredResume: StructuredResume;
}) {
  return [
    `STRUCTURED_RESUME_UPLOAD: ${fileName}`,
    `SOURCE_TYPE: ${fileType || "unknown"}`,
    `DETECTED_SECTIONS: ${structuredResume.sectionNames.join(", ")}`,
    "",
    structuredResume.structuredText
  ].join("\n");
}

function normalizeSectionHeading(line: string) {
  const cleaned = line
    .replace(/[:|]+$/g, "")
    .replace(/^[\-–—•\s]+/g, "")
    .trim();
  const key = cleaned.toLowerCase();
  if (sectionAliases[key]) return sectionAliases[key];

  const compactHeading = /^[A-Z][A-Z\s/&-]{2,32}$/.test(cleaned) && cleaned.split(/\s+/).length <= 4;
  if (!compactHeading) return null;

  return sectionAliases[key] ?? toTitleCase(cleaned);
}

function toTitleCase(text: string) {
  return text
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
