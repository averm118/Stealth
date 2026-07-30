import type {
  CandidateProfile,
  Job,
  ResumeEditOperation,
  ResumeFitSkillPruneCandidate,
  ResumeLayoutMap,
  ResumeLayoutMapParagraph
} from "@/lib/types";

const stopWords = new Set(
  "a an and are as at be by for from in into is it of on or that the this to with using used through across within while".split(
    " "
  )
);

export function estimateResumeRenderedWidth(value: string) {
  let width = 0;
  for (const character of String(value || "")) {
    if (/\s/.test(character)) width += 0.42;
    else if (/[MW@%&]/.test(character)) width += 1.28;
    else if (/[A-Z0-9]/.test(character)) width += 1.02;
    else if (/[ilI1|.,:;'`]/.test(character)) width += 0.48;
    else width += 0.86;
  }
  return width;
}

export function scoreResumeEditOperations(input: {
  operations: ResumeEditOperation[];
  job: Job;
  profile: CandidateProfile;
  layoutMap?: ResumeLayoutMap | null;
}) {
  const jobText = normalize(`${input.job.title} ${input.job.skills.join(" ")} ${input.job.description}`);
  const jobTokens = contentTokens(jobText);
  const paragraphById = new Map(
    (input.layoutMap?.paragraphs ?? []).map((paragraph) => [paragraph.id, paragraph])
  );
  const paragraphsByGroup = new Map<string, ResumeLayoutMapParagraph[]>();
  (input.layoutMap?.paragraphs ?? []).forEach((paragraph) => {
    if (!paragraph.groupId) return;
    const group = paragraphsByGroup.get(paragraph.groupId) ?? [];
    group.push(paragraph);
    paragraphsByGroup.set(paragraph.groupId, group);
  });
  const acceptedByGroup = new Map<string, string[]>();
  let rejectedForRedundancy = 0;

  const scored = input.operations
    .map((operation) => {
      const paragraph = operation.paragraphId
        ? paragraphById.get(operation.paragraphId)
        : undefined;
      const groupId = paragraph?.groupId;
      const siblingTexts = groupId
        ? (paragraphsByGroup.get(groupId) ?? [])
            .filter((candidate) => candidate.id !== paragraph?.id && candidate.isBullet)
            .map((candidate) => candidate.text)
        : [];
      const previouslyAccepted = groupId ? acceptedByGroup.get(groupId) ?? [] : [];
      const candidates = uniqueText([
        operation.replacement,
        ...(operation.replacementCandidates ?? [])
      ]).filter(
        (candidate) =>
          !isSubstantiallyRepetitive(candidate, [
            ...siblingTexts,
            ...previouslyAccepted
          ], operation.targetKeywords ?? [])
      );

      if (!candidates.length) {
        rejectedForRedundancy += 1;
        return null;
      }

      const originalWidth = Math.max(
        1,
        estimateResumeRenderedWidth(operation.original)
      );
      const [replacement, ...alternatives] = candidates;
      const originalRelevance = scoreTextRelevance(
        operation.original,
        operation.targetKeywords ?? [],
        jobTokens
      );
      const replacementRelevance = scoreTextRelevance(
        replacement,
        operation.targetKeywords ?? [],
        jobTokens
      );
      const widthRatio = estimateResumeRenderedWidth(replacement) / originalWidth;
      const impactGain = round(
        replacementRelevance -
          originalRelevance -
          Math.max(0, widthRatio - 1.03) * 20,
        1
      );
      const introducedCoverage = countKeywordCoverage(
        replacement,
        operation.targetKeywords ?? []
      ) > countKeywordCoverage(operation.original, operation.targetKeywords ?? []);

      if (impactGain < 1 && !introducedCoverage) return null;

      const scoredOperation: ResumeEditOperation = {
        ...operation,
        replacement,
        replacementCandidates: alternatives.slice(0, 2),
        originalRelevanceScore: originalRelevance,
        replacementRelevanceScore: replacementRelevance,
        impactGain,
        estimatedWidthRatio: round(widthRatio, 3),
        evidenceParagraphIds: uniqueText([
          operation.paragraphId ?? "",
          ...(operation.evidenceParagraphIds ?? [])
        ]).slice(0, 8),
        distinctContribution:
          operation.distinctContribution?.trim() ||
          (operation.targetKeywords ?? []).slice(0, 3).join(", ") ||
          "Higher job relevance without duplicating sibling bullets."
      };

      if (groupId) {
        acceptedByGroup.set(groupId, [...previouslyAccepted, replacement]);
      }
      return scoredOperation;
    })
    .filter((operation): operation is ResumeEditOperation => Boolean(operation))
    .sort((first, second) => {
      const impact = (second.impactGain ?? 0) - (first.impactGain ?? 0);
      if (impact !== 0) return impact;
      return (second.priority ?? 3) - (first.priority ?? 3);
    });

  return { operations: scored, rejectedForRedundancy };
}

export function createSkillPruneCandidates(input: {
  layoutMap?: ResumeLayoutMap | null;
  job: Job;
  profile: CandidateProfile;
  operations: ResumeEditOperation[];
}): ResumeFitSkillPruneCandidate[] {
  const skillLines = (input.layoutMap?.paragraphs ?? []).filter(
    (paragraph) => paragraph.role === "skills_line" && paragraph.canEdit
  );
  if (!skillLines.length) return [];

  const jobText = normalize(`${input.job.title} ${input.job.skills.join(" ")} ${input.job.description}`);
  const acceptedText = normalize(
    input.operations
      .flatMap((operation) => [
        operation.replacement,
        ...(operation.replacementCandidates ?? []),
        ...(operation.targetKeywords ?? [])
      ])
      .join(" ")
  );
  const resumeText = normalize(input.profile.resumeText);
  const parsed = skillLines.map((paragraph) => parseSkillLine(paragraph.text));
  const totalSkills = parsed.reduce((sum, line) => sum + line.skills.length, 0);
  const overallLimit = Math.max(0, Math.floor(totalSkills * 0.2));
  if (!overallLimit) return [];

  const candidates: ResumeFitSkillPruneCandidate[] = [];
  skillLines.forEach((paragraph, index) => {
    const line = parsed[index];
    if (!line || line.skills.length < 4) return;

    line.skills
      .map((skill) => ({
        skill,
        relevanceScore: scoreSkillRelevance(
          skill,
          jobText,
          acceptedText,
          resumeText
        )
      }))
      .filter((item) => item.relevanceScore < 60)
      .sort((first, second) => first.relevanceScore - second.relevanceScore)
      .slice(0, Math.min(2, line.skills.length - 3))
      .forEach((item) => {
        candidates.push({
          paragraphId: paragraph.id,
          categoryLabel: line.label,
          skill: item.skill,
          relevanceScore: item.relevanceScore,
          contentHash: paragraph.contentHash,
          originalText: paragraph.text,
          reason: `Lower relevance to ${input.job.title} than the retained skills in this category.`
        });
      });
  });

  return candidates
    .sort((first, second) => first.relevanceScore - second.relevanceScore)
    .slice(0, overallLimit);
}

export function isSubstantiallyRepetitive(
  candidate: string,
  existing: string[],
  ignoredKeywords: string[] = []
) {
  const ignored = new Set(
    ignoredKeywords.flatMap((keyword) => [...contentTokens(keyword)])
  );
  const candidateTokens = contentTokens(candidate, ignored);
  if (candidateTokens.size < 3) return false;

  return existing.some((value) => {
    const existingTokens = contentTokens(value, ignored);
    if (existingTokens.size < 3) return false;
    const intersection = [...candidateTokens].filter((token) =>
      existingTokens.has(token)
    ).length;
    const union = new Set([...candidateTokens, ...existingTokens]).size;
    const jaccard = intersection / Math.max(1, union);
    return jaccard >= 0.68 || repeatedPhraseRatio(candidate, value) >= 0.5;
  });
}

function scoreTextRelevance(
  value: string,
  targetKeywords: string[],
  jobTokens: Set<string>
) {
  const tokens = contentTokens(value);
  const keywordCoverage = targetKeywords.length
    ? countKeywordCoverage(value, targetKeywords) / targetKeywords.length
    : 0;
  const dutyOverlap = [...tokens].filter((token) => jobTokens.has(token)).length /
    Math.max(1, Math.min(tokens.size, 12));
  const specificity = Math.min(
    1,
    ((value.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []).length +
      (value.match(/\b[A-Z][A-Za-z0-9+#.-]{1,}\b/g) ?? []).length * 0.25) /
      3
  );
  return round(
    Math.min(100, keywordCoverage * 55 + dutyOverlap * 30 + specificity * 15),
    1
  );
}

function scoreSkillRelevance(
  skill: string,
  jobText: string,
  acceptedText: string,
  resumeText: string
) {
  const normalized = normalize(skill);
  if (!normalized) return 0;
  if (containsPhrase(jobText, normalized)) return 100;
  if (containsPhrase(acceptedText, normalized)) return 90;
  if (normalized.length >= 3 && countPhrase(resumeText, normalized) > 1) {
    return 70;
  }
  return 10;
}

function parseSkillLine(value: string) {
  const separatorIndex = value.indexOf(":");
  const label = separatorIndex >= 0 ? value.slice(0, separatorIndex + 1).trim() : "Skills:";
  const body = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value;
  return {
    label,
    skills: body
      .split(/[,;|]/)
      .map((skill) => skill.trim())
      .filter(Boolean)
  };
}

function countKeywordCoverage(value: string, keywords: string[]) {
  const normalized = normalize(value);
  return uniqueText(keywords).filter((keyword) =>
    containsPhrase(normalized, normalize(keyword))
  ).length;
}

function contentTokens(value: string, ignored = new Set<string>()) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter(
        (token) =>
          token.length >= 3 &&
          !stopWords.has(token) &&
          !ignored.has(token) &&
          !/^\d+$/.test(token)
      )
  );
}

function repeatedPhraseRatio(first: string, second: string) {
  const firstPhrases = trigrams(first);
  const secondPhrases = trigrams(second);
  if (!firstPhrases.size || !secondPhrases.size) return 0;
  const overlap = [...firstPhrases].filter((phrase) =>
    secondPhrases.has(phrase)
  ).length;
  return overlap / Math.max(1, Math.min(firstPhrases.size, secondPhrases.size));
}

function trigrams(value: string) {
  const tokens = normalize(value).split(" ").filter(Boolean);
  const output = new Set<string>();
  for (let index = 0; index <= tokens.length - 3; index += 1) {
    output.add(tokens.slice(index, index + 3).join(" "));
  }
  return output;
}

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./%-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, needle: string) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function countPhrase(haystack: string, needle: string) {
  if (!needle) return 0;
  return ` ${haystack} `.split(` ${needle} `).length - 1;
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
