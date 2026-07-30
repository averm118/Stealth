export type WorkType = "Remote" | "Hybrid" | "On-site";
export type SponsorshipFriendliness = "high" | "medium" | "low" | "unknown";
export type CompetitionLevel = "low" | "medium" | "high";
export type SavedStatus = "saved" | "applied" | "interview" | "rejected" | "offer";
export type SignalConfidence = "low" | "medium" | "high";
export type LookingFor = "Full-time job" | "Part-time job" | "Internship";
export type JobSource = "mock" | "greenhouse" | "lever" | "ashby" | "workday" | "manual" | "company_careers" | "user_submitted";
export type JobSourceCategory = "tech" | "ai-software" | "logistics" | "retail" | "manufacturing" | "finance" | "operations";

export type ResumeDocumentMetadata = {
  storagePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  textHash: string;
  exactLayoutSupported: boolean;
};

export type Job = {
  id: string;
  company: string;
  title: string;
  location: string;
  workType: WorkType;
  postedDate: string;
  sponsorshipFriendly: SponsorshipFriendliness;
  competitionLevel: CompetitionLevel;
  skills: string[];
  description: string;
  applyUrl: string;
};

export type JobSourceMetadata = {
  source: JobSource;
  sourceJobId: string;
  sourceUrl: string;
  sourceCategory?: JobSourceCategory;
  importedAt: string;
  rawLocation: string;
  qualityWarnings: string[];
};

export type IngestedJobRecord = Job & {
  metadata: JobSourceMetadata;
};

export type CandidateProfile = {
  resumeText: string;
  resumeDocument?: ResumeDocumentMetadata | null;
  headline: string;
  targetRoles: string[];
  skills: string[];
  strengths: string[];
  education: string[];
  experienceFocus: string[];
  extractionNotes: string[];
  roleEvidence: string[];
  skillEvidence: string[];
  educationEvidence: string[];
  confidenceNotes: string[];
  personality: {
    summary: string;
    traits: {
      label: string;
      evidence: string;
      confidence: SignalConfidence;
    }[];
    workStyle: string[];
    communicationStyle: string;
  };
  goals: string[];
  visaSponsorshipNeeded: boolean;
  lookingFor: LookingFor;
};

export type MatchResult = {
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  why: string[];
  suggestedKeywords: string[];
};

export type ScoreBreakdownFactor = {
  score: number;
  reason: string;
};

export type ScoreBreakdown = {
  skillFit: ScoreBreakdownFactor;
  roleFit: ScoreBreakdownFactor;
  projectEvidence: ScoreBreakdownFactor;
  sponsorshipFit: ScoreBreakdownFactor;
  competitionReadiness: ScoreBreakdownFactor;
};

export type AiJobAnalysis = MatchResult & {
  scoreBreakdown: ScoreBreakdown;
  confidence: SignalConfidence;
  matchedEvidence: string[];
  gaps: string[];
  jobHighlights: string[];
  applicationStrategy: string;
  source: "gemini" | "local_fallback";
  generatedAt: string;
};

export type AiDashboardJobMatch = {
  jobId: string;
  confidence: SignalConfidence;
  reason: string;
  matchedSignals: string[];
  riskFlags: string[];
  source: "gemini";
};

export type ResumeBulletRewrite = {
  original: string;
  rewrite: string;
  reason: string;
};

export type ResumeDocxParagraphRole =
  | "contact_header"
  | "section_heading"
  | "divider"
  | "education_line"
  | "skills_line"
  | "role_header"
  | "date_locked_header"
  | "bullet"
  | "activity_line"
  | "blank"
  | "body";

export type ResumeLayoutMapParagraph = {
  id: string;
  role: ResumeDocxParagraphRole;
  sectionName?: string;
  text: string;
  editableText: string;
  lockedText?: string;
  leftText?: string;
  rightText?: string;
  hasTabStop?: boolean;
  tabStopSignature?: string;
  isTerminalSection?: boolean;
  editableCharBudget?: number;
  contentHash?: string;
  semanticTags?: string[];
  safeOperations?: ResumeEditOperationType[];
  fallbackIds?: string[];
  insertAnchorIds?: string[];
  nearbyBulletIds?: string[];
  maxReplacementChars?: number;
  lockedRegions?: string[];
  groupId?: string;
  bulletIndex?: number;
  bulletCount?: number;
  format?: {
    alignment?: "left" | "center" | "right" | "justify";
    spacingBeforePt?: number;
    spacingAfterPt?: number;
    lineSpacing?: number;
    leftIndentPt?: number;
    rightIndentPt?: number;
    firstLineIndentPt?: number;
    hangingIndentPt?: number;
    fontFamily?: string;
    fontSizePt?: number;
    bold?: boolean;
    italic?: boolean;
  };
  hasLockedDate: boolean;
  isBullet: boolean;
  canEdit: boolean;
  canInsertAfter: boolean;
  canRemove: boolean;
};

export type ResumeLayoutMap = {
  source: "docx";
  paragraphs: ResumeLayoutMapParagraph[];
  sectionNames: string[];
  page?: {
    widthPt: number;
    heightPt: number;
    marginTopPt: number;
    marginRightPt: number;
    marginBottomPt: number;
    marginLeftPt: number;
  };
  defaultFont?: string;
  defaultFontSizePt?: number;
  generatedAt: string;
};

export type ResumeEditOperationType =
  | "replace_line"
  | "append_to_line"
  | "shorten_line"
  | "replace_paragraph_text"
  | "append_to_paragraph"
  | "replace_bullet"
  | "insert_bullet_after"
  | "shorten_paragraph"
  | "remove_low_priority_paragraph";

export type ResumeEditOperation = {
  type: ResumeEditOperationType;
  paragraphId?: string;
  insertAfterParagraphId?: string;
  targetSection?: string;
  sectionName?: string;
  original: string;
  replacement: string;
  replacementCandidates?: string[];
  keywords?: string[];
  priority?: number;
  evidenceSource?: string;
  targetKeywords?: string[];
  fallbackParagraphIds?: string[];
  contentHash?: string;
  maxChars?: number;
  originalRelevanceScore?: number;
  replacementRelevanceScore?: number;
  impactGain?: number;
  estimatedWidthRatio?: number;
  evidenceParagraphIds?: string[];
  distinctContribution?: string;
  reason: string;
};

export type ResumeFitRemovalCandidate = {
  paragraphId: string;
  sectionName: string;
  groupId: string;
  original: string;
  relevanceScore: number;
  contentHash?: string;
  reason: string;
};

export type ResumeFitSkillPruneCandidate = {
  paragraphId: string;
  categoryLabel: string;
  skill: string;
  relevanceScore: number;
  contentHash?: string;
  originalText: string;
  reason: string;
};

export type ResumeAppliedChange = ResumeEditOperation & {
  matchedText?: string;
  repairNote?: string;
};

export type ResumeSkippedChange = Partial<ResumeEditOperation> & {
  skipReason: string;
  skipCategory?: string;
};

export type ResumeLayoutAdjustment = {
  fontScale: number;
  reason: string;
};

export type ResumeDocxEditStats = {
  appliedEdits: number;
  insertedBullets: number;
  removedLines: number;
  skippedEdits: number;
  repairedEdits?: number;
  convertedEdits?: number;
  autoShortenedEdits?: number;
  shortenedEdits?: number;
  selectedCandidateCount?: number;
  shortenedForFit?: number;
  removedForFit?: number;
  rejectedForFit?: number;
  targetPageCount?: number;
  finalPageCount?: number;
  removedParagraphIds?: string[];
  replacedLowRelevanceBullets?: number;
  skillsPruned?: number;
  prunedSkills?: string[];
  fontScaleApplied?: number;
  rejectedForRedundancy?: number;
  skippedByReason?: Record<string, number>;
  validationStatus: "valid" | "not_generated" | "failed";
  fontScale: number;
  warning?: string;
};

export type ResumePdfFidelityFailureReason =
  | "page_overflow"
  | "protected_anchor_moved"
  | "line_growth"
  | "typography_drift"
  | "incomplete_text"
  | "package_drift"
  | "pixel_drift"
  | "insufficient_anchors";

export type ResumeVerifiedFitSelection = {
  operationIndex: number;
  candidateIndex: number;
  paragraphId?: string;
  contentHash?: string;
  impactGain?: number;
};

export type ResumeVerifiedFitPlan = {
  version: 1 | 2;
  baselineFingerprint: string;
  validationMode: "strict" | "balanced";
  selections: ResumeVerifiedFitSelection[];
  approvedSkillPrunes?: ResumeFitSkillPruneCandidate[];
  approvedRemovalParagraphIds: string[];
  bodyFontScale?: number;
  rejectedOperationIndexes: number[];
  renderAttempts: number;
};

export type ResumePdfFidelityReport = {
  status: "verified" | "failed";
  renderer: "microsoft_graph_word";
  pageCount: number;
  pageGeometryPreserved: boolean;
  protectedAnchorsChecked: number;
  stableAnchorsChecked: number;
  maxAnchorDeltaPt: number;
  packageIntegrityPreserved: boolean;
  typographyPreserved: boolean;
  dateAlignmentPreserved: boolean;
  paragraphStructurePreserved: boolean;
  fullTextCoveragePreserved: boolean;
  pixelFidelityPreserved: boolean;
  changedPixelsOutsideMasksRatio: number;
  compactMode: boolean;
  removedParagraphsVerified: number;
  fontScaleApplied?: number;
  fontScalingVerified?: boolean;
  failureReasons: ResumePdfFidelityFailureReason[];
  warnings: string[];
};

export type TailoredResumeResult = {
  score: number;
  missingKeywords: string[];
  suggestedSkills: string[];
  editOperations: ResumeEditOperation[];
  fitRemovalCandidates: ResumeFitRemovalCandidate[];
  fitSkillPruneCandidates: ResumeFitSkillPruneCandidate[];
  appliedChanges: ResumeAppliedChange[];
  skippedChanges: ResumeSkippedChange[];
  layoutAdjustment: ResumeLayoutAdjustment;
  docxEditStats?: ResumeDocxEditStats;
  bulletRewrites: ResumeBulletRewrite[];
  atsNotes: string[];
  tailoredResumeText: string;
  source: "gemini" | "original_resume";
  generatedAt: string;
};

export type CoverLetterResult = {
  score: number;
  talkingPoints: string[];
  toneNotes: string[];
  coverLetterText: string;
  source: "gemini";
  generatedAt: string;
};
