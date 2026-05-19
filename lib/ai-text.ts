const sectionHints = [
  "education",
  "skills",
  "experience",
  "work experience",
  "projects",
  "certifications",
  "leadership",
  "work authorization",
  "authorization"
];

export function prepareResumeForAi(resumeText: string, maxChars: number) {
  const cleaned = resumeText
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) return cleaned;

  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const selected: string[] = [];
  let activeSection = false;

  for (const line of lines) {
    const lower = line.toLowerCase().replace(/[^a-z ]/g, "").trim();
    const isSection = sectionHints.some((hint) => lower === hint || lower.startsWith(`${hint} `));

    if (isSection) activeSection = true;
    if (activeSection || selected.length < 24) selected.push(line);
    if (selected.join("\n").length >= maxChars) break;
  }

  const compact = selected.join("\n").slice(0, maxChars).trim();
  return compact || cleaned.slice(0, maxChars).trim();
}

export function stableTextHash(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}
