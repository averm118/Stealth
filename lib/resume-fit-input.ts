import type {
  ResumeBulletRewrite,
  ResumeEditOperation,
  ResumeFitRemovalCandidate,
  ResumeFitSkillPruneCandidate,
  ResumeVerifiedFitPlan
} from "@/lib/types";

export function cleanResumeFitOperations(value: unknown): ResumeEditOperation[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ResumeEditOperation | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ResumeEditOperation>;
      if (
        !isAllowedOperationType(record.type) ||
        typeof record.original !== "string" ||
        typeof record.replacement !== "string"
      ) {
        return null;
      }

      const replacement = cleanCompleteText(record.replacement);
      if (!replacement) return null;

      return {
        type: record.type,
        paragraphId:
          typeof record.paragraphId === "string" ? record.paragraphId : undefined,
        insertAfterParagraphId:
          typeof record.insertAfterParagraphId === "string"
            ? record.insertAfterParagraphId
            : undefined,
        targetSection:
          typeof record.targetSection === "string" ? record.targetSection : undefined,
        sectionName:
          typeof record.sectionName === "string" ? record.sectionName : undefined,
        original: record.original,
        replacement,
        replacementCandidates: Array.isArray(record.replacementCandidates)
          ? record.replacementCandidates
              .filter((candidate): candidate is string => typeof candidate === "string")
              .map(cleanCompleteText)
              .filter(Boolean)
              .slice(0, 3)
          : undefined,
        keywords: cleanStringArray(record.keywords, 8),
        priority:
          typeof record.priority === "number" && Number.isFinite(record.priority)
            ? Math.max(1, Math.min(5, Math.round(record.priority)))
            : undefined,
        evidenceSource:
          typeof record.evidenceSource === "string" ? record.evidenceSource : undefined,
        targetKeywords: cleanStringArray(record.targetKeywords, 10),
        fallbackParagraphIds: cleanStringArray(record.fallbackParagraphIds, 8),
        contentHash:
          typeof record.contentHash === "string" ? record.contentHash : undefined,
        maxChars:
          typeof record.maxChars === "number" && Number.isFinite(record.maxChars)
            ? Math.max(24, Math.min(900, Math.round(record.maxChars)))
            : undefined,
        originalRelevanceScore: cleanScore(record.originalRelevanceScore),
        replacementRelevanceScore: cleanScore(record.replacementRelevanceScore),
        impactGain:
          typeof record.impactGain === "number" && Number.isFinite(record.impactGain)
            ? Math.max(-100, Math.min(100, Math.round(record.impactGain * 10) / 10))
            : undefined,
        estimatedWidthRatio:
          typeof record.estimatedWidthRatio === "number" &&
          Number.isFinite(record.estimatedWidthRatio)
            ? Math.max(0.25, Math.min(2, record.estimatedWidthRatio))
            : undefined,
        evidenceParagraphIds: cleanStringArray(record.evidenceParagraphIds, 8),
        distinctContribution:
          typeof record.distinctContribution === "string"
            ? record.distinctContribution.slice(0, 180)
            : undefined,
        reason:
          typeof record.reason === "string" ? record.reason : "Tailored for this role."
      };
    })
    .filter((item): item is ResumeEditOperation => Boolean(item))
    .slice(0, 14);
}

export function cleanResumeFitSkillPruneCandidates(
  value: unknown
): ResumeFitSkillPruneCandidate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value
    .map((item): ResumeFitSkillPruneCandidate | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ResumeFitSkillPruneCandidate>;
      if (
        typeof record.paragraphId !== "string" ||
        typeof record.categoryLabel !== "string" ||
        typeof record.skill !== "string" ||
        typeof record.originalText !== "string"
      ) {
        return null;
      }
      const key = `${record.paragraphId}:${record.skill.toLowerCase().trim()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        paragraphId: record.paragraphId.slice(0, 40),
        categoryLabel: record.categoryLabel.slice(0, 80),
        skill: record.skill.slice(0, 80),
        relevanceScore: cleanScore(record.relevanceScore) ?? 50,
        contentHash:
          typeof record.contentHash === "string"
            ? record.contentHash.slice(0, 40)
            : undefined,
        originalText: record.originalText.slice(0, 500),
        reason:
          typeof record.reason === "string"
            ? record.reason.slice(0, 180)
            : "Lower relevance than retained skills."
      };
    })
    .filter((item): item is ResumeFitSkillPruneCandidate => Boolean(item))
    .slice(0, 12);
}

export function cleanResumeFitRewrites(value: unknown): ResumeBulletRewrite[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): ResumeBulletRewrite | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ResumeBulletRewrite>;
      if (
        typeof record.original !== "string" ||
        typeof record.rewrite !== "string"
      ) {
        return null;
      }
      const rewrite = cleanCompleteText(record.rewrite);
      if (!rewrite) return null;
      return {
        original: record.original,
        rewrite,
        reason:
          typeof record.reason === "string"
            ? record.reason
            : "Tailored for this role."
      };
    })
    .filter((item): item is ResumeBulletRewrite => Boolean(item))
    .slice(0, 12);
}

export function cleanResumeFitRemovalCandidates(
  value: unknown
): ResumeFitRemovalCandidate[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value
    .map((item): ResumeFitRemovalCandidate | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ResumeFitRemovalCandidate>;
      if (
        typeof record.paragraphId !== "string" ||
        typeof record.sectionName !== "string" ||
        typeof record.groupId !== "string" ||
        typeof record.original !== "string" ||
        seen.has(record.paragraphId)
      ) {
        return null;
      }
      seen.add(record.paragraphId);
      return {
        paragraphId: record.paragraphId,
        sectionName: record.sectionName,
        groupId: record.groupId,
        original: record.original,
        relevanceScore:
          typeof record.relevanceScore === "number" &&
          Number.isFinite(record.relevanceScore)
            ? Math.max(0, Math.min(100, Math.round(record.relevanceScore)))
            : 50,
        contentHash:
          typeof record.contentHash === "string" ? record.contentHash : undefined,
        reason:
          typeof record.reason === "string"
            ? record.reason
            : "Lower relevance than the accepted same-section improvement."
      };
    })
    .filter((item): item is ResumeFitRemovalCandidate => Boolean(item))
    .slice(0, 8);
}

export function cleanResumeVerifiedFitPlan(
  value: unknown
): ResumeVerifiedFitPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<ResumeVerifiedFitPlan>;
  if (
    (record.version !== 1 && record.version !== 2) ||
    typeof record.baselineFingerprint !== "string" ||
    !/^[a-f0-9]{24}$/i.test(record.baselineFingerprint) ||
    (record.validationMode !== "strict" &&
      record.validationMode !== "balanced") ||
    !Array.isArray(record.selections)
  ) {
    return undefined;
  }

  const selections = record.selections
    .map((item): ResumeVerifiedFitPlan["selections"][number] | null => {
      if (!item || typeof item !== "object") return null;
      const selection = item as ResumeVerifiedFitPlan["selections"][number];
      if (
        !Number.isInteger(selection.operationIndex) ||
        selection.operationIndex < 0 ||
        selection.operationIndex > 35 ||
        !Number.isInteger(selection.candidateIndex) ||
        selection.candidateIndex < 0 ||
        selection.candidateIndex > 3
      ) {
        return null;
      }
      const cleaned: ResumeVerifiedFitPlan["selections"][number] = {
        operationIndex: selection.operationIndex,
        candidateIndex: selection.candidateIndex
      };
      if (typeof selection.paragraphId === "string") {
        cleaned.paragraphId = selection.paragraphId.slice(0, 40);
      }
      if (typeof selection.contentHash === "string") {
        cleaned.contentHash = selection.contentHash.slice(0, 40);
      }
      if (
        typeof selection.impactGain === "number" &&
        Number.isFinite(selection.impactGain)
      ) {
        cleaned.impactGain = Math.max(
          -100,
          Math.min(100, Math.round(selection.impactGain * 10) / 10)
        );
      }
      return cleaned;
    })
    .filter(
      (item): item is ResumeVerifiedFitPlan["selections"][number] =>
        Boolean(item)
    )
    .slice(0, 14);

  return {
    version: record.version,
    baselineFingerprint: record.baselineFingerprint,
    validationMode: record.validationMode,
    selections,
    approvedSkillPrunes: cleanResumeFitSkillPruneCandidates(
      record.approvedSkillPrunes
    ),
    approvedRemovalParagraphIds: cleanStringArray(
      record.approvedRemovalParagraphIds,
      4
    ).filter((id) => /^p\d{1,5}$/.test(id)),
    bodyFontScale:
      typeof record.bodyFontScale === "number" &&
      Number.isFinite(record.bodyFontScale)
        ? Math.max(0.94, Math.min(1, record.bodyFontScale))
        : 1,
    rejectedOperationIndexes: Array.isArray(record.rejectedOperationIndexes)
      ? record.rejectedOperationIndexes
          .filter(
            (index): index is number =>
              Number.isInteger(index) && index >= 0 && index <= 35
          )
          .slice(0, 36)
      : [],
    renderAttempts:
      typeof record.renderAttempts === "number" &&
      Number.isFinite(record.renderAttempts)
        ? Math.max(0, Math.min(24, Math.round(record.renderAttempts)))
        : 0
  };
}

function cleanScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value * 10) / 10))
    : undefined;
}

function isAllowedOperationType(
  value: unknown
): value is ResumeEditOperation["type"] {
  return (
    value === "replace_line" ||
    value === "append_to_line" ||
    value === "shorten_line" ||
    value === "replace_paragraph_text" ||
    value === "append_to_paragraph" ||
    value === "replace_bullet" ||
    value === "shorten_paragraph"
  );
}

function cleanStringArray(value: unknown, maximum: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maximum)
    : [];
}

function cleanCompleteText(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= 2000 ? cleaned : "";
}
