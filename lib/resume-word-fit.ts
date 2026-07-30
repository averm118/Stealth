import "server-only";

import { createHash } from "node:crypto";
import {
  createTailoredDocxBuildResultFromOriginal,
  validateExactDocxPackageFidelity,
  type TailoredDocxBuildResult
} from "./resume-docx.ts";
import {
  inspectResumePdf,
  validateResumePdfFidelity
} from "./resume-pdf-fidelity.ts";
import { renderDocxWithMicrosoftWord } from "./resume-word-renderer.ts";
import { estimateResumeRenderedWidth } from "./resume-impact.ts";
import type {
  ResumeBulletRewrite,
  ResumeEditOperation,
  ResumeFitRemovalCandidate,
  ResumeFitSkillPruneCandidate,
  ResumePdfFidelityFailureReason,
  ResumePdfFidelityReport,
  ResumeVerifiedFitPlan,
  ResumeVerifiedFitSelection
} from "@/lib/types";

type WordFitInput = {
  originalDocx: Buffer;
  editOperations: ResumeEditOperation[];
  rewrites?: ResumeBulletRewrite[];
  fitRemovalCandidates?: ResumeFitRemovalCandidate[];
  fitSkillPruneCandidates?: ResumeFitSkillPruneCandidate[];
  originalPdf?: Buffer;
  verifiedFitPlan?: ResumeVerifiedFitPlan;
};

type WordFitDependencies = {
  render?: typeof renderDocxWithMicrosoftWord;
  validate?: typeof validateResumePdfFidelity;
};

type FitAttempt = {
  build: TailoredDocxBuildResult;
  pdf: Buffer;
  report: ResumePdfFidelityReport;
};

type IndexedOperation = {
  operationIndex: number;
  operation: ResumeEditOperation;
};

type OperationVariant = IndexedOperation & {
  candidateIndex: number;
};

export type WordFitResult = {
  docx: Uint8Array;
  pdf: Buffer;
  report: ResumePdfFidelityReport;
  build: TailoredDocxBuildResult;
  fitPlan: ResumeVerifiedFitPlan;
  fallbackToOriginal: boolean;
  attempts: number;
};

const maxCandidateRenderAttempts = 24;
const maxFitRemovals = 4;
const bodyFontScaleSteps = [0.98, 0.96, 0.94] as const;

export async function fitResumeWithMicrosoftWord(
  input: WordFitInput,
  dependencies: WordFitDependencies = {}
): Promise<WordFitResult> {
  const render = dependencies.render ?? renderDocxWithMicrosoftWord;
  const validate = dependencies.validate ?? validateResumePdfFidelity;
  const originalPdf = input.originalPdf ?? (await render(input.originalDocx));
  const baseline = await inspectResumePdf(originalPdf);
  const baselineFingerprint = createBaselineFingerprint(input.originalDocx);
  const sourceOperations = getSourceOperations(input);
  const indexedOperations = sourceOperations
    .map((operation, operationIndex) => ({
      operationIndex,
      operation: cloneOperation(operation)
    }))
    .sort(compareIndexedOperations);
  const removalCandidates = normalizeRemovalCandidates(
    input.fitRemovalCandidates ?? []
  );
  const skillPruneCandidates = normalizeSkillPruneCandidates(
    input.fitSkillPruneCandidates ?? []
  );
  const originalBuild = await createTailoredDocxBuildResultFromOriginal(
    input.originalDocx,
    { editOperations: [], rewrites: [] }
  );
  const originalReport = await validate(originalPdf, originalPdf, {
    packageIntegrityPreserved: true,
    expectedReplacementTexts: []
  });
  const originalAttempt: FitAttempt = {
    build: originalBuild,
    pdf: originalPdf,
    report: originalReport
  };
  let attempts = 0;

  const requestedPlan = input.verifiedFitPlan;
  if (
    (requestedPlan?.version === 1 || requestedPlan?.version === 2) &&
    requestedPlan.baselineFingerprint === baselineFingerprint &&
    requestedPlan.selections.length > 0 &&
    attempts < maxCandidateRenderAttempts
  ) {
    const selectedVariants = variantsFromFitPlan(
      indexedOperations,
      requestedPlan
    );
    if (selectedVariants.length === requestedPlan.selections.length) {
      const plannedAttempt = await buildAndValidate({
        originalDocx: input.originalDocx,
        originalPdf,
        variants: selectedVariants,
        approvedRemovalParagraphIds:
          requestedPlan.approvedRemovalParagraphIds,
        approvedSkillPrunes: requestedPlan.approvedSkillPrunes ?? [],
        bodyFontScale: requestedPlan.bodyFontScale ?? 1,
        targetPageCount: baseline.pageCount,
        validationMode: requestedPlan.validationMode,
        render,
        validate
      });
      attempts += 1;
      if (
        isVerifiedAttempt(
          plannedAttempt,
          baseline.pageCount,
          selectedVariants.length,
          requestedPlan.approvedRemovalParagraphIds.length,
          requestedPlan.approvedSkillPrunes?.length ?? 0,
          requestedPlan.bodyFontScale ?? 1
        )
      ) {
        return finalizeSuccessfulResult({
          attempt: plannedAttempt,
          selections: selectedVariants,
          approvedRemovalParagraphIds:
            requestedPlan.approvedRemovalParagraphIds,
          approvedSkillPrunes: requestedPlan.approvedSkillPrunes ?? [],
          bodyFontScale: requestedPlan.bodyFontScale ?? 1,
          rejectedReasons: new Map(),
          totalOperationCount: sourceOperations.length,
          baselineFingerprint,
          validationMode: requestedPlan.validationMode,
          attempts
        });
      }
    }
  }

  const strongestVariants = indexedOperations
    .map((entry) => getOperationVariants(entry)[0])
    .filter((variant): variant is OperationVariant => Boolean(variant));
  let singleStrongestFailure:
    | {
        operationIndex: number;
        reason: ResumePdfFidelityFailureReason;
      }
    | null = null;

  if (strongestVariants.length > 0 && attempts < maxCandidateRenderAttempts) {
    const fullAttempt = await buildAndValidate({
      originalDocx: input.originalDocx,
      originalPdf,
      variants: strongestVariants,
      approvedRemovalParagraphIds: [],
      approvedSkillPrunes: [],
      bodyFontScale: 1,
      targetPageCount: baseline.pageCount,
      validationMode: "strict",
      render,
      validate
    });
    attempts += 1;
    if (
      isVerifiedAttempt(
        fullAttempt,
        baseline.pageCount,
        strongestVariants.length,
        0,
        0,
        1
      )
    ) {
      return finalizeSuccessfulResult({
        attempt: fullAttempt,
        selections: strongestVariants,
        approvedRemovalParagraphIds: [],
        approvedSkillPrunes: [],
        bodyFontScale: 1,
        rejectedReasons: new Map(),
        totalOperationCount: sourceOperations.length,
        baselineFingerprint,
        validationMode: "strict",
        attempts
      });
    }
    if (strongestVariants.length === 1 && strongestVariants[0]) {
      singleStrongestFailure = {
        operationIndex: strongestVariants[0].operationIndex,
        reason: getPrimaryFailureReason(fullAttempt)
      };
    }
  }

  let bestAttempt = originalAttempt;
  let acceptedVariants: OperationVariant[] = [];
  let approvedRemovalParagraphIds: string[] = [];
  let approvedSkillPrunes: ResumeFitSkillPruneCandidate[] = [];
  let bodyFontScale = 1;
  let validationMode: ResumeVerifiedFitPlan["validationMode"] = "strict";
  const completedOperationIndexes = new Set<number>();
  const rejectedReasons = new Map<number, ResumePdfFidelityFailureReason>();

  for (const entry of indexedOperations) {
    if (
      completedOperationIndexes.has(entry.operationIndex) ||
      attempts >= maxCandidateRenderAttempts
    ) {
      continue;
    }

    const allVariants = getOperationVariants(entry);
    const variants =
      singleStrongestFailure?.operationIndex === entry.operationIndex
        ? allVariants.slice(1)
        : allVariants;
    let accepted = false;
    let lastFitFailure: ResumePdfFidelityFailureReason | null =
      singleStrongestFailure?.operationIndex === entry.operationIndex
        ? singleStrongestFailure.reason
        : null;

    for (const variant of variants) {
      if (attempts >= maxCandidateRenderAttempts) break;
      const candidateAttempt = await buildAndValidate({
        originalDocx: input.originalDocx,
        originalPdf,
        variants: [...acceptedVariants, variant],
        approvedRemovalParagraphIds,
        approvedSkillPrunes,
        bodyFontScale,
        targetPageCount: baseline.pageCount,
        validationMode,
        render,
        validate
      });
      attempts += 1;

      if (
        isVerifiedAttempt(
          candidateAttempt,
          baseline.pageCount,
          acceptedVariants.length + 1,
          approvedRemovalParagraphIds.length,
          approvedSkillPrunes.length,
          bodyFontScale
        )
      ) {
        acceptedVariants = [...acceptedVariants, variant];
        completedOperationIndexes.add(entry.operationIndex);
        bestAttempt = candidateAttempt;
        accepted = true;
        break;
      }

      lastFitFailure = getPrimaryFailureReason(candidateAttempt);
    }

    const shortestVariant = allVariants.at(-1);
    if (
      !accepted &&
      shortestVariant &&
      isFitFailure(lastFitFailure) &&
      attempts < maxCandidateRenderAttempts
    ) {
      const compensator = findCompensatingVariant(
        indexedOperations,
        entry,
        acceptedVariants,
        completedOperationIndexes
      );

      if (compensator) {
        const compensatedAttempt = await buildAndValidate({
          originalDocx: input.originalDocx,
          originalPdf,
          variants: [...acceptedVariants, shortestVariant, compensator],
          approvedRemovalParagraphIds,
          approvedSkillPrunes,
          bodyFontScale,
          targetPageCount: baseline.pageCount,
          validationMode: "balanced",
          render,
          validate
        });
        attempts += 1;
        if (
          isVerifiedAttempt(
            compensatedAttempt,
            baseline.pageCount,
            acceptedVariants.length + 2,
            approvedRemovalParagraphIds.length,
            approvedSkillPrunes.length,
            bodyFontScale
          )
        ) {
          acceptedVariants = [
            ...acceptedVariants,
            shortestVariant,
            compensator
          ];
          completedOperationIndexes.add(entry.operationIndex);
          completedOperationIndexes.add(compensator.operationIndex);
          validationMode = "balanced";
          bestAttempt = compensatedAttempt;
          accepted = true;
        } else {
          lastFitFailure = getPrimaryFailureReason(compensatedAttempt);
        }
      }
    }

    if (
      !accepted &&
      shortestVariant &&
      isFitFailure(lastFitFailure) &&
      attempts < maxCandidateRenderAttempts
    ) {
      let pendingSkillPrunes = [...approvedSkillPrunes];
      const availablePrunes = getEligibleSkillPruneCandidates({
        candidates: skillPruneCandidates,
        approved: approvedSkillPrunes,
        variants: [...acceptedVariants, shortestVariant]
      }).slice(0, 3);

      for (const skillPrune of availablePrunes) {
        if (attempts >= maxCandidateRenderAttempts) break;
        pendingSkillPrunes = [...pendingSkillPrunes, skillPrune];
        const prunedAttempt = await buildAndValidate({
          originalDocx: input.originalDocx,
          originalPdf,
          variants: [...acceptedVariants, shortestVariant],
          approvedRemovalParagraphIds,
          approvedSkillPrunes: pendingSkillPrunes,
          bodyFontScale,
          targetPageCount: baseline.pageCount,
          validationMode: "balanced",
          render,
          validate
        });
        attempts += 1;

        if (
          isVerifiedAttempt(
            prunedAttempt,
            baseline.pageCount,
            acceptedVariants.length + 1,
            approvedRemovalParagraphIds.length,
            pendingSkillPrunes.length,
            bodyFontScale
          )
        ) {
          acceptedVariants = [...acceptedVariants, shortestVariant];
          approvedSkillPrunes = pendingSkillPrunes;
          completedOperationIndexes.add(entry.operationIndex);
          validationMode = "balanced";
          bestAttempt = prunedAttempt;
          accepted = true;
          break;
        }
        lastFitFailure = getPrimaryFailureReason(prunedAttempt);
      }

      if (!accepted && isFitFailure(lastFitFailure)) {
        const scalingPrunes = pendingSkillPrunes;
        for (const nextScale of bodyFontScaleSteps) {
          if (
            attempts >= maxCandidateRenderAttempts ||
            nextScale >= bodyFontScale - 0.001
          ) {
            continue;
          }
          const scaledAttempt = await buildAndValidate({
            originalDocx: input.originalDocx,
            originalPdf,
            variants: [...acceptedVariants, shortestVariant],
            approvedRemovalParagraphIds,
            approvedSkillPrunes: scalingPrunes,
            bodyFontScale: nextScale,
            targetPageCount: baseline.pageCount,
            validationMode: "balanced",
            render,
            validate
          });
          attempts += 1;

          if (
            isVerifiedAttempt(
              scaledAttempt,
              baseline.pageCount,
              acceptedVariants.length + 1,
              approvedRemovalParagraphIds.length,
              scalingPrunes.length,
              nextScale
            )
          ) {
            acceptedVariants = [...acceptedVariants, shortestVariant];
            approvedSkillPrunes = scalingPrunes;
            bodyFontScale = nextScale;
            completedOperationIndexes.add(entry.operationIndex);
            validationMode = "balanced";
            bestAttempt = scaledAttempt;
            accepted = true;
            break;
          }
          lastFitFailure = getPrimaryFailureReason(scaledAttempt);
        }
      }
    }

    if (
      !accepted &&
      shortestVariant &&
      isFitFailure(lastFitFailure) &&
      (entry.operation.priority ?? 3) >= 3
    ) {
      const eligibleRemovals = getEligibleRemovalCandidates({
        candidates: removalCandidates,
        operation: entry.operation,
        approvedIds: approvedRemovalParagraphIds
      });

      for (const removal of eligibleRemovals) {
        if (attempts >= maxCandidateRenderAttempts) break;
        const nextRemovalIds = [
          ...approvedRemovalParagraphIds,
          removal.paragraphId
        ];
        const compactAttempt = await buildAndValidate({
          originalDocx: input.originalDocx,
          originalPdf,
          variants: [...acceptedVariants, shortestVariant],
          approvedRemovalParagraphIds: nextRemovalIds,
          approvedSkillPrunes,
          bodyFontScale,
          targetPageCount: baseline.pageCount,
          validationMode: "balanced",
          render,
          validate
        });
        attempts += 1;

        if (
          compactAttempt.build.removedParagraphIds.includes(
            removal.paragraphId
          ) &&
          isVerifiedAttempt(
            compactAttempt,
            baseline.pageCount,
            acceptedVariants.length + 1,
            nextRemovalIds.length,
            approvedSkillPrunes.length,
            bodyFontScale
          )
        ) {
          acceptedVariants = [...acceptedVariants, shortestVariant];
          approvedRemovalParagraphIds = nextRemovalIds;
          completedOperationIndexes.add(entry.operationIndex);
          validationMode = "balanced";
          bestAttempt = compactAttempt;
          accepted = true;
          break;
        }

        lastFitFailure = getPrimaryFailureReason(compactAttempt);
      }
    }

    if (!accepted) {
      completedOperationIndexes.add(entry.operationIndex);
      rejectedReasons.set(
        entry.operationIndex,
        lastFitFailure ?? "line_growth"
      );
    }
  }

  if (acceptedVariants.length > 0) {
    return finalizeSuccessfulResult({
      attempt: bestAttempt,
      selections: acceptedVariants,
      approvedRemovalParagraphIds,
      approvedSkillPrunes,
      bodyFontScale,
      rejectedReasons,
      totalOperationCount: sourceOperations.length,
      baselineFingerprint,
      validationMode,
      attempts
    });
  }

  return finalizeOriginalFallback({
    originalAttempt,
    operations: sourceOperations,
    baselineFingerprint,
    targetPageCount: baseline.pageCount,
    attempts,
    rejectedReasons
  });
}

async function buildAndValidate(input: {
  originalDocx: Buffer;
  originalPdf: Buffer;
  variants: OperationVariant[];
  approvedRemovalParagraphIds: string[];
  approvedSkillPrunes: ResumeFitSkillPruneCandidate[];
  bodyFontScale: number;
  targetPageCount: number;
  validationMode: ResumeVerifiedFitPlan["validationMode"];
  render: typeof renderDocxWithMicrosoftWord;
  validate: typeof validateResumePdfFidelity;
}): Promise<FitAttempt> {
  const operations = input.variants.map((variant) => variant.operation);
  const build = await createTailoredDocxBuildResultFromOriginal(
    input.originalDocx,
    {
      editOperations: operations,
      rewrites: [],
      approvedRemovalParagraphIds: input.approvedRemovalParagraphIds,
      approvedSkillPrunes: input.approvedSkillPrunes,
      layoutAdjustment: {
        fontScale: input.bodyFontScale,
        reason:
          input.bodyFontScale < 0.999
            ? `Eligible body text scaled to ${Math.round(input.bodyFontScale * 100)}% for verified page fit.`
            : "Original DOCX typography is locked."
      }
    }
  );
  const packageReport = await validateExactDocxPackageFidelity(
    input.originalDocx,
    build.buffer,
    {
      removedParagraphIds: build.removedParagraphIds,
      bodyFontScale: build.bodyFontScale,
      scaledParagraphIds: build.scaledParagraphIds
    }
  );
  const pdf = await input.render(build.buffer);
  const report = await input.validate(input.originalPdf, pdf, {
    packageIntegrityPreserved: packageReport.packagePartsChecked > 0,
    compactMode: build.removedParagraphIds.length > 0,
    balancedMode: input.validationMode === "balanced",
    removedParagraphCount: build.removedParagraphIds.length,
    bodyFontScale: build.bodyFontScale,
    expectedReplacementTexts: build.appliedChanges.map(
      (change) => change.replacement
    )
  });
  build.stats.targetPageCount = input.targetPageCount;
  build.stats.finalPageCount = report.pageCount;

  return { build, pdf, report };
}

function isVerifiedAttempt(
  attempt: FitAttempt,
  targetPageCount: number,
  expectedAppliedCount: number,
  expectedRemovalCount: number,
  expectedSkillPruneCount: number,
  expectedBodyFontScale: number
) {
  return (
    attempt.report.status === "verified" &&
    attempt.report.pageCount === targetPageCount &&
    attempt.report.fullTextCoveragePreserved &&
    attempt.build.appliedChanges.length === expectedAppliedCount &&
    attempt.build.removedParagraphIds.length === expectedRemovalCount &&
    attempt.build.prunedSkills.length === expectedSkillPruneCount &&
    Math.abs(attempt.build.bodyFontScale - expectedBodyFontScale) < 0.001
  );
}

function finalizeSuccessfulResult(input: {
  attempt: FitAttempt;
  selections: OperationVariant[];
  approvedRemovalParagraphIds: string[];
  approvedSkillPrunes: ResumeFitSkillPruneCandidate[];
  bodyFontScale: number;
  rejectedReasons: Map<number, ResumePdfFidelityFailureReason>;
  totalOperationCount: number;
  baselineFingerprint: string;
  validationMode: ResumeVerifiedFitPlan["validationMode"];
  attempts: number;
}): WordFitResult {
  const selectedIndexes = new Set(
    input.selections.map((selection) => selection.operationIndex)
  );
  const rejectedOperationIndexes = Array.from(
    { length: input.totalOperationCount },
    (_, index) => index
  ).filter((index) => !selectedIndexes.has(index));
  const stats = input.attempt.build.stats;
  const alternativeCount = input.selections.filter(
    (selection) => selection.candidateIndex > 0
  ).length;

  stats.selectedCandidateCount = input.selections.length;
  stats.shortenedForFit = alternativeCount;
  stats.rejectedForFit = rejectedOperationIndexes.length;
  stats.removedForFit = input.attempt.build.removedParagraphIds.length;
  stats.removedParagraphIds = [...input.attempt.build.removedParagraphIds];
  stats.replacedLowRelevanceBullets = input.selections.filter(
    (selection) =>
      selection.operation.type === "replace_bullet" &&
      (selection.operation.impactGain ?? 0) > 0
  ).length;
  stats.skillsPruned = input.approvedSkillPrunes.length;
  stats.prunedSkills = input.approvedSkillPrunes.map((item) => item.skill);
  stats.fontScaleApplied = input.bodyFontScale;
  stats.skippedEdits =
    input.attempt.build.skippedChanges.length +
    rejectedOperationIndexes.length;
  stats.skippedByReason = {
    ...(stats.skippedByReason ?? {}),
    ...(input.attempt.build.removedParagraphIds.length > 0
      ? { removed_for_fit: input.attempt.build.removedParagraphIds.length }
      : {}),
    ...(input.attempts > 1 ? { page_fit_retry: input.attempts - 1 } : {})
  };
  rejectedOperationIndexes.forEach((operationIndex) => {
    const reason = input.rejectedReasons.get(operationIndex) ?? "line_growth";
    stats.skippedByReason![reason] =
      (stats.skippedByReason![reason] ?? 0) + 1;
  });
  if (rejectedOperationIndexes.length > 0) {
    stats.warning = `${input.selections.length} edits passed Word verification; ${rejectedOperationIndexes.length} were skipped to preserve the original layout.`;
  }

  const fitPlan = createFitPlan({
    baselineFingerprint: input.baselineFingerprint,
    validationMode: input.validationMode,
    selections: input.selections,
    approvedSkillPrunes: input.approvedSkillPrunes,
    approvedRemovalParagraphIds: input.approvedRemovalParagraphIds,
    bodyFontScale: input.bodyFontScale,
    rejectedOperationIndexes,
    attempts: input.attempts
  });

  return {
    docx: input.attempt.build.buffer,
    pdf: input.attempt.pdf,
    report: input.attempt.report,
    build: input.attempt.build,
    fitPlan,
    fallbackToOriginal: false,
    attempts: input.attempts
  };
}

function finalizeOriginalFallback(input: {
  originalAttempt: FitAttempt;
  operations: ResumeEditOperation[];
  baselineFingerprint: string;
  targetPageCount: number;
  attempts: number;
  rejectedReasons: Map<number, ResumePdfFidelityFailureReason>;
}): WordFitResult {
  const { build } = input.originalAttempt;
  build.stats.rejectedForFit = input.operations.length;
  build.stats.skillsPruned = 0;
  build.stats.prunedSkills = [];
  build.stats.fontScaleApplied = 1;
  build.stats.targetPageCount = input.targetPageCount;
  build.stats.finalPageCount = input.targetPageCount;
  build.stats.skippedEdits = input.operations.length;
  build.stats.skippedByReason = {
    page_fit_retry: Math.max(1, input.attempts)
  };
  input.operations.forEach((_, operationIndex) => {
    const reason = input.rejectedReasons.get(operationIndex) ?? "line_growth";
    build.stats.skippedByReason![reason] =
      (build.stats.skippedByReason![reason] ?? 0) + 1;
  });
  build.stats.warning =
    "No individual complete rewrite passed Word fit verification, so Stealth returned the unchanged original.";
  const rejectedOperationIndexes = input.operations.map(
    (_, index) => index
  );
  const fitPlan = createFitPlan({
    baselineFingerprint: input.baselineFingerprint,
    validationMode: "strict",
    selections: [],
    approvedSkillPrunes: [],
    approvedRemovalParagraphIds: [],
    bodyFontScale: 1,
    rejectedOperationIndexes,
    attempts: input.attempts
  });

  return {
    docx: build.buffer,
    pdf: input.originalAttempt.pdf,
    report: input.originalAttempt.report,
    build,
    fitPlan,
    fallbackToOriginal: true,
    attempts: input.attempts
  };
}

function getOperationVariants(entry: IndexedOperation): OperationVariant[] {
  const candidates = uniqueCandidates([
    entry.operation.replacement,
    ...(entry.operation.replacementCandidates ?? [])
  ]);
  const [strongest, ...alternatives] = candidates;
  const ordered = [
    ...(strongest ? [strongest] : []),
    ...alternatives.sort(
      (first, second) =>
        estimateResumeRenderedWidth(second) -
        estimateResumeRenderedWidth(first)
    )
  ];

  return ordered.map((replacement, candidateIndex) => ({
    operationIndex: entry.operationIndex,
    candidateIndex,
    operation: {
      ...cloneOperation(entry.operation),
      replacement,
      replacementCandidates: undefined
    }
  }));
}

function getSourceOperations(input: WordFitInput): ResumeEditOperation[] {
  if (input.editOperations.length > 0) {
    return input.editOperations.map(cloneOperation);
  }

  return (input.rewrites ?? []).map((rewrite) => ({
    type: "replace_bullet",
    original: rewrite.original,
    replacement: rewrite.rewrite,
    reason: rewrite.reason,
    priority: 3
  }));
}

function variantsFromFitPlan(
  operations: IndexedOperation[],
  plan: ResumeVerifiedFitPlan
) {
  const byIndex = new Map(
    operations.map((entry) => [entry.operationIndex, entry])
  );
  const variants: OperationVariant[] = [];

  for (const selection of plan.selections) {
    const entry = byIndex.get(selection.operationIndex);
    if (!entry) return [];
    if (
      selection.paragraphId &&
      entry.operation.paragraphId !== selection.paragraphId
    ) {
      return [];
    }
    if (
      selection.contentHash &&
      entry.operation.contentHash !== selection.contentHash
    ) {
      return [];
    }
    const variant = getOperationVariants(entry).find(
      (candidate) => candidate.candidateIndex === selection.candidateIndex
    );
    if (!variant) return [];
    variants.push(variant);
  }

  return variants;
}

function findCompensatingVariant(
  operations: IndexedOperation[],
  target: IndexedOperation,
  accepted: OperationVariant[],
  completedIndexes: Set<number>
) {
  const acceptedIndexes = new Set(
    accepted.map((variant) => variant.operationIndex)
  );
  const targetSection = normalizeSection(
    target.operation.sectionName || target.operation.targetSection || ""
  );
  const candidates = operations.filter((entry) => {
    if (
      entry.operationIndex === target.operationIndex ||
      acceptedIndexes.has(entry.operationIndex) ||
      completedIndexes.has(entry.operationIndex)
    ) {
      return false;
    }
    if (
      entry.operation.type !== "shorten_line" &&
      entry.operation.type !== "shorten_paragraph"
    ) {
      return false;
    }
    return (
      normalizeSection(
        entry.operation.sectionName || entry.operation.targetSection || ""
      ) === targetSection
    );
  });

  for (const entry of candidates) {
    const shortest = getOperationVariants(entry).sort(
      (first, second) =>
      estimateResumeRenderedWidth(first.operation.replacement) -
        estimateResumeRenderedWidth(second.operation.replacement)
    )[0];
    if (
      shortest &&
      estimateResumeRenderedWidth(shortest.operation.replacement) <
        estimateResumeRenderedWidth(entry.operation.original)
    ) {
      return shortest;
    }
  }

  return null;
}

function getEligibleRemovalCandidates(input: {
  candidates: ResumeFitRemovalCandidate[];
  operation: ResumeEditOperation;
  approvedIds: string[];
}) {
  if (input.approvedIds.length >= maxFitRemovals) return [];
  const targetSection = normalizeSection(
    input.operation.sectionName || input.operation.targetSection || ""
  );
  const approved = input.candidates.filter((candidate) =>
    input.approvedIds.includes(candidate.paragraphId)
  );
  const sectionCounts = new Map<string, number>();
  const groups = new Set<string>();
  approved.forEach((candidate) => {
    const section = normalizeSection(candidate.sectionName);
    sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
    groups.add(candidate.groupId);
  });

  return input.candidates.filter((candidate) => {
    const section = normalizeSection(candidate.sectionName);
    if (section !== targetSection) return false;
    if (input.approvedIds.includes(candidate.paragraphId)) return false;
    if ((sectionCounts.get(section) ?? 0) >= 2) return false;
    if (groups.has(candidate.groupId)) return false;
    return true;
  });
}

function createFitPlan(input: {
  baselineFingerprint: string;
  validationMode: ResumeVerifiedFitPlan["validationMode"];
  selections: OperationVariant[];
  approvedSkillPrunes: ResumeFitSkillPruneCandidate[];
  approvedRemovalParagraphIds: string[];
  bodyFontScale: number;
  rejectedOperationIndexes: number[];
  attempts: number;
}): ResumeVerifiedFitPlan {
  const selections: ResumeVerifiedFitSelection[] = input.selections
    .sort((first, second) => first.operationIndex - second.operationIndex)
    .map((selection) => ({
      operationIndex: selection.operationIndex,
      candidateIndex: selection.candidateIndex,
      paragraphId: selection.operation.paragraphId,
      contentHash: selection.operation.contentHash,
      impactGain: selection.operation.impactGain
    }));

  return {
    version: 2,
    baselineFingerprint: input.baselineFingerprint,
    validationMode: input.validationMode,
    selections,
    approvedSkillPrunes: input.approvedSkillPrunes.map((candidate) => ({
      ...candidate
    })),
    approvedRemovalParagraphIds: [...input.approvedRemovalParagraphIds],
    bodyFontScale: input.bodyFontScale,
    rejectedOperationIndexes: [...input.rejectedOperationIndexes].sort(
      (first, second) => first - second
    ),
    renderAttempts: input.attempts
  };
}

function getPrimaryFailureReason(attempt: FitAttempt) {
  if (attempt.build.appliedChanges.length === 0) {
    const category = attempt.build.skippedChanges[0]?.skipCategory;
    if (category === "protected_content") return "package_drift";
    if (category === "mapping" || category === "protected_layout") {
      return "protected_anchor_moved";
    }
  }
  return (
    attempt.report.failureReasons?.[0] ??
    inferFailureReasonFromWarnings(attempt.report.warnings)
  );
}

function inferFailureReasonFromWarnings(warnings: string[]) {
  const combined = warnings.join(" ").toLowerCase();
  if (combined.includes("page count") || combined.includes("page dimensions")) {
    return "page_overflow" as const;
  }
  if (combined.includes("missing") || combined.includes("incomplete")) {
    return "incomplete_text" as const;
  }
  if (combined.includes("font")) return "typography_drift" as const;
  if (combined.includes("package")) return "package_drift" as const;
  if (combined.includes("date") || combined.includes("protected")) {
    return "protected_anchor_moved" as const;
  }
  return "line_growth" as const;
}

function isFitFailure(reason: ResumePdfFidelityFailureReason | null) {
  return reason === "page_overflow" || reason === "line_growth";
}

function compareIndexedOperations(
  first: IndexedOperation,
  second: IndexedOperation
) {
  const impactDifference =
    (second.operation.impactGain ?? 0) - (first.operation.impactGain ?? 0);
  if (impactDifference !== 0) return impactDifference;

  const priorityDifference =
    (second.operation.priority ?? 3) - (first.operation.priority ?? 3);
  if (priorityDifference !== 0) return priorityDifference;

  const firstGrowth =
    estimateResumeRenderedWidth(first.operation.replacement) -
    estimateResumeRenderedWidth(first.operation.original);
  const secondGrowth =
    estimateResumeRenderedWidth(second.operation.replacement) -
    estimateResumeRenderedWidth(second.operation.original);
  if ((firstGrowth <= 0) !== (secondGrowth <= 0)) {
    return firstGrowth <= 0 ? -1 : 1;
  }
  return firstGrowth - secondGrowth;
}

function uniqueCandidates(values: string[]) {
  const seen = new Set<string>();
  const candidates: string[] = [];
  values.forEach((value) => {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    candidates.push(cleaned);
  });
  return candidates;
}

function normalizeRemovalCandidates(
  candidates: ResumeFitRemovalCandidate[]
) {
  const unique = new Map<string, ResumeFitRemovalCandidate>();
  candidates.forEach((candidate) => {
    if (!candidate.paragraphId || unique.has(candidate.paragraphId)) return;
    unique.set(candidate.paragraphId, {
      ...candidate,
      relevanceScore: Math.max(
        0,
        Math.min(100, Math.round(candidate.relevanceScore))
      )
    });
  });
  return [...unique.values()]
    .sort((first, second) => first.relevanceScore - second.relevanceScore)
    .slice(0, 10);
}

function normalizeSkillPruneCandidates(
  candidates: ResumeFitSkillPruneCandidate[]
) {
  const unique = new Map<string, ResumeFitSkillPruneCandidate>();
  const perParagraph = new Map<string, number>();
  candidates
    .sort((first, second) => first.relevanceScore - second.relevanceScore)
    .forEach((candidate) => {
      const key = `${candidate.paragraphId}:${candidate.skill
        .toLowerCase()
        .trim()}`;
      if (
        !candidate.paragraphId ||
        !candidate.skill.trim() ||
        unique.has(key) ||
        (perParagraph.get(candidate.paragraphId) ?? 0) >= 2
      ) {
        return;
      }
      unique.set(key, {
        ...candidate,
        relevanceScore: Math.max(
          0,
          Math.min(100, Math.round(candidate.relevanceScore))
        )
      });
      perParagraph.set(
        candidate.paragraphId,
        (perParagraph.get(candidate.paragraphId) ?? 0) + 1
      );
    });
  return [...unique.values()].slice(0, 12);
}

function getEligibleSkillPruneCandidates(input: {
  candidates: ResumeFitSkillPruneCandidate[];
  approved: ResumeFitSkillPruneCandidate[];
  variants: OperationVariant[];
}) {
  const approvedKeys = new Set(
    input.approved.map(
      (candidate) =>
        `${candidate.paragraphId}:${candidate.skill.toLowerCase().trim()}`
    )
  );
  const editedParagraphIds = new Set(
    input.variants
      .map((variant) => variant.operation.paragraphId)
      .filter((id): id is string => Boolean(id))
  );
  const approvedPerParagraph = new Map<string, number>();
  input.approved.forEach((candidate) => {
    approvedPerParagraph.set(
      candidate.paragraphId,
      (approvedPerParagraph.get(candidate.paragraphId) ?? 0) + 1
    );
  });

  return input.candidates.filter((candidate) => {
    const key = `${candidate.paragraphId}:${candidate.skill
      .toLowerCase()
      .trim()}`;
    return (
      !approvedKeys.has(key) &&
      !editedParagraphIds.has(candidate.paragraphId) &&
      (approvedPerParagraph.get(candidate.paragraphId) ?? 0) < 2
    );
  });
}

function cloneOperation(operation: ResumeEditOperation): ResumeEditOperation {
  return {
    ...operation,
    replacementCandidates: operation.replacementCandidates
      ? [...operation.replacementCandidates]
      : undefined,
    keywords: operation.keywords ? [...operation.keywords] : undefined,
    targetKeywords: operation.targetKeywords
      ? [...operation.targetKeywords]
      : undefined,
    fallbackParagraphIds: operation.fallbackParagraphIds
      ? [...operation.fallbackParagraphIds]
      : undefined,
    evidenceParagraphIds: operation.evidenceParagraphIds
      ? [...operation.evidenceParagraphIds]
      : undefined
  };
}

function normalizeSection(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createBaselineFingerprint(docx: Buffer) {
  return createHash("sha256").update(docx).digest("hex").slice(0, 24);
}
