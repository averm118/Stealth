export type WorkType = "Remote" | "Hybrid" | "On-site";
export type SponsorshipFriendliness = "high" | "medium" | "low" | "unknown";
export type CompetitionLevel = "low" | "medium" | "high";
export type SavedStatus = "saved" | "applied" | "interview" | "rejected" | "offer";
export type SignalConfidence = "low" | "medium" | "high";

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

export type CandidateProfile = {
  resumeText: string;
  headline: string;
  targetRoles: string[];
  skills: string[];
  strengths: string[];
  education: string[];
  experienceFocus: string[];
  extractionNotes: string[];
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
};

export type MatchResult = {
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  why: string[];
  suggestedKeywords: string[];
};
