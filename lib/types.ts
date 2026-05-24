export type WorkType = "Remote" | "Hybrid" | "On-site";
export type SponsorshipFriendliness = "high" | "medium" | "low" | "unknown";
export type CompetitionLevel = "low" | "medium" | "high";
export type SavedStatus = "saved" | "applied" | "interview" | "rejected" | "offer";
export type SignalConfidence = "low" | "medium" | "high";
export type LookingFor = "Full-time job" | "Part-time job" | "Internship";
export type JobSource = "mock" | "greenhouse" | "lever" | "ashby" | "workday" | "manual" | "company_careers";
export type JobSourceCategory = "tech" | "ai-software" | "logistics" | "retail" | "manufacturing" | "finance" | "operations";

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
