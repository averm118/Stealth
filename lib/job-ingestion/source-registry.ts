import type { CompetitionLevel, JobSource, JobSourceCategory, SponsorshipFriendliness } from "@/lib/types";

export type JobSourceConfig = {
  id: string;
  source: Exclude<JobSource, "mock" | "manual">;
  company: string;
  boardToken?: string;
  workday?: {
    host: string;
    tenant: string;
    site: string;
    searchText?: string;
    pageLimit?: number;
    maxPages?: number;
  };
  sponsorshipFriendly?: SponsorshipFriendliness;
  competitionLevel?: CompetitionLevel;
  category: JobSourceCategory;
  enabled: boolean;
};

export const approvedJobSources: JobSourceConfig[] = [
  {
    id: "greenhouse-airbnb",
    source: "greenhouse",
    company: "Airbnb",
    boardToken: "airbnb",
    sponsorshipFriendly: "high",
    competitionLevel: "high",
    category: "tech",
    enabled: true
  },
  {
    id: "greenhouse-stripe",
    source: "greenhouse",
    company: "Stripe",
    boardToken: "stripe",
    sponsorshipFriendly: "high",
    competitionLevel: "high",
    category: "finance",
    enabled: true
  },
  {
    id: "greenhouse-databricks",
    source: "greenhouse",
    company: "Databricks",
    boardToken: "databricks",
    sponsorshipFriendly: "high",
    competitionLevel: "high",
    category: "ai-software",
    enabled: true
  },
  {
    id: "greenhouse-robinhood",
    source: "greenhouse",
    company: "Robinhood",
    boardToken: "robinhood",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "finance",
    enabled: true
  },
  {
    id: "greenhouse-coinbase",
    source: "greenhouse",
    company: "Coinbase",
    boardToken: "coinbase",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "finance",
    enabled: true
  },
  {
    id: "greenhouse-plaid",
    source: "greenhouse",
    company: "Plaid",
    boardToken: "plaid",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "finance",
    enabled: true
  },
  {
    id: "greenhouse-flexport",
    source: "greenhouse",
    company: "Flexport",
    boardToken: "flexport",
    sponsorshipFriendly: "medium",
    competitionLevel: "medium",
    category: "logistics",
    enabled: true
  },
  {
    id: "greenhouse-samsara",
    source: "greenhouse",
    company: "Samsara",
    boardToken: "samsara",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "operations",
    enabled: true
  },
  {
    id: "greenhouse-verkada",
    source: "greenhouse",
    company: "Verkada",
    boardToken: "verkada",
    sponsorshipFriendly: "medium",
    competitionLevel: "medium",
    category: "manufacturing",
    enabled: true
  },
  {
    id: "greenhouse-rippling",
    source: "greenhouse",
    company: "Rippling",
    boardToken: "rippling",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "operations",
    enabled: true
  },
  {
    id: "greenhouse-figma",
    source: "greenhouse",
    company: "Figma",
    boardToken: "figma",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "tech",
    enabled: true
  },
  {
    id: "greenhouse-scaleai",
    source: "greenhouse",
    company: "Scale AI",
    boardToken: "scaleai",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "ai-software",
    enabled: true
  },
  {
    id: "greenhouse-opendoor",
    source: "greenhouse",
    company: "Opendoor",
    boardToken: "opendoor",
    sponsorshipFriendly: "medium",
    competitionLevel: "medium",
    category: "operations",
    enabled: true
  },
  {
    id: "greenhouse-instacart",
    source: "greenhouse",
    company: "Instacart",
    boardToken: "instacart",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "retail",
    enabled: true
  },
  {
    id: "lever-ramp",
    source: "lever",
    company: "Ramp",
    boardToken: "ramp",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "finance",
    enabled: true
  },
  {
    id: "lever-netflix",
    source: "lever",
    company: "Netflix",
    boardToken: "netflix",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "tech",
    enabled: true
  },
  {
    id: "lever-affirm",
    source: "lever",
    company: "Affirm",
    boardToken: "affirm",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "finance",
    enabled: true
  },
  {
    id: "lever-duolingo",
    source: "lever",
    company: "Duolingo",
    boardToken: "duolingo",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "tech",
    enabled: true
  },
  {
    id: "ashby-anthropic",
    source: "ashby",
    company: "Anthropic",
    boardToken: "anthropic",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "ai-software",
    enabled: true
  },
  {
    id: "ashby-perplexity",
    source: "ashby",
    company: "Perplexity",
    boardToken: "perplexity",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "ai-software",
    enabled: true
  },
  {
    id: "ashby-cursor",
    source: "ashby",
    company: "Cursor",
    boardToken: "cursor",
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "ai-software",
    enabled: true
  },
  {
    id: "workday-target",
    source: "workday",
    company: "Target",
    workday: {
      host: "https://target.wd5.myworkdayjobs.com",
      tenant: "target",
      site: "targetcareers",
      searchText: "intern",
      pageLimit: 20,
      maxPages: 4
    },
    sponsorshipFriendly: "medium",
    competitionLevel: "medium",
    category: "retail",
    enabled: true
  },
  {
    id: "workday-johnson-johnson",
    source: "workday",
    company: "Johnson & Johnson",
    workday: {
      host: "https://jj.wd5.myworkdayjobs.com",
      tenant: "jj",
      site: "JJ",
      searchText: "intern",
      pageLimit: 20,
      maxPages: 4
    },
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "manufacturing",
    enabled: true
  },
  {
    id: "workday-general-motors",
    source: "workday",
    company: "General Motors",
    workday: {
      host: "https://generalmotors.wd5.myworkdayjobs.com",
      tenant: "generalmotors",
      site: "General_Motors",
      searchText: "intern",
      pageLimit: 20,
      maxPages: 4
    },
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "manufacturing",
    enabled: true
  },
  {
    id: "workday-nike",
    source: "workday",
    company: "Nike",
    workday: {
      host: "https://nike.wd1.myworkdayjobs.com",
      tenant: "nike",
      site: "nike",
      searchText: "intern",
      pageLimit: 20,
      maxPages: 4
    },
    sponsorshipFriendly: "medium",
    competitionLevel: "high",
    category: "retail",
    enabled: true
  }
];
