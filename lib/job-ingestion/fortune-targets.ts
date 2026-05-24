import type { CompetitionLevel, JobSourceCategory, SponsorshipFriendliness } from "@/lib/types";

export type CompanyTarget = {
  id: string;
  company: string;
  careersUrl: string;
  category: JobSourceCategory;
  sponsorshipFriendly: SponsorshipFriendliness;
  competitionLevel: CompetitionLevel;
  enabled: boolean;
};

export const fortuneCompanyTargets: CompanyTarget[] = [
  target("walmart", "Walmart", "https://careers.walmart.com", "retail", "medium", "high"),
  target("amazon", "Amazon", "https://www.amazon.jobs", "tech", "medium", "high"),
  target("apple", "Apple", "https://jobs.apple.com", "tech", "medium", "high"),
  target("cvs-health", "CVS Health", "https://jobs.cvshealth.com", "retail", "medium", "medium"),
  target("unitedhealth-group", "UnitedHealth Group", "https://careers.unitedhealthgroup.com", "operations", "medium", "high"),
  target("exxonmobil", "ExxonMobil", "https://jobs.exxonmobil.com", "operations", "medium", "high"),
  target("alphabet", "Alphabet", "https://www.google.com/about/careers/applications", "tech", "medium", "high"),
  target("mckesson", "McKesson", "https://careers.mckesson.com", "logistics", "medium", "medium"),
  target("cencora", "Cencora", "https://careers.cencora.com", "logistics", "medium", "medium"),
  target("costco", "Costco", "https://www.costco.com/jobs.html", "retail", "low", "medium"),
  target("jpmorgan-chase", "JPMorgan Chase", "https://careers.jpmorgan.com", "finance", "medium", "high"),
  target("microsoft", "Microsoft", "https://jobs.careers.microsoft.com", "tech", "high", "high"),
  target("cardinal-health", "Cardinal Health", "https://jobs.cardinalhealth.com", "logistics", "medium", "medium"),
  target("chevron", "Chevron", "https://careers.chevron.com", "operations", "medium", "high"),
  target("cigna", "Cigna", "https://jobs.thecignagroup.com", "operations", "medium", "medium"),
  target("ford", "Ford", "https://corporate.ford.com/careers.html", "manufacturing", "medium", "high"),
  target("bank-of-america", "Bank of America", "https://careers.bankofamerica.com", "finance", "medium", "high"),
  target("general-motors", "General Motors", "https://generalmotors.wd5.myworkdayjobs.com/General_Motors", "manufacturing", "medium", "high"),
  target("elevance-health", "Elevance Health", "https://careers.elevancehealth.com", "operations", "medium", "medium"),
  target("citigroup", "Citigroup", "https://jobs.citi.com", "finance", "medium", "high"),
  target("meta", "Meta", "https://www.metacareers.com", "tech", "medium", "high"),
  target("centene", "Centene", "https://jobs.centene.com", "operations", "medium", "medium"),
  target("home-depot", "The Home Depot", "https://careers.homedepot.com", "retail", "medium", "medium"),
  target("marathon-petroleum", "Marathon Petroleum", "https://www.marathonpetroleum.com/Careers", "operations", "medium", "medium"),
  target("kroger", "Kroger", "https://www.thekrogerco.com/careers", "retail", "medium", "medium"),
  target("phillips-66", "Phillips 66", "https://www.phillips66.com/careers", "operations", "medium", "medium"),
  target("walgreens", "Walgreens", "https://jobs.walgreens.com", "retail", "medium", "medium"),
  target("valero", "Valero", "https://www.valero.com/careers", "operations", "medium", "medium"),
  target("dell", "Dell Technologies", "https://jobs.dell.com", "tech", "medium", "high"),
  target("target", "Target", "https://target.wd5.myworkdayjobs.com/targetcareers", "retail", "medium", "medium"),
  target("verizon", "Verizon", "https://mycareer.verizon.com", "tech", "medium", "high"),
  target("lowes", "Lowe's", "https://talent.lowes.com", "retail", "medium", "medium"),
  target("johnson-johnson", "Johnson & Johnson", "https://jj.wd5.myworkdayjobs.com/JJ", "manufacturing", "medium", "high"),
  target("tesla", "Tesla", "https://www.tesla.com/careers", "manufacturing", "medium", "high"),
  target("fedex", "FedEx", "https://careers.fedex.com", "logistics", "medium", "medium"),
  target("humana", "Humana", "https://careers.humana.com", "operations", "medium", "medium"),
  target("wells-fargo", "Wells Fargo", "https://www.wellsfargojobs.com", "finance", "medium", "high"),
  target("state-farm", "State Farm", "https://jobs.statefarm.com", "finance", "medium", "medium"),
  target("ups", "UPS", "https://www.jobs-ups.com", "logistics", "medium", "medium"),
  target("pepsico", "PepsiCo", "https://www.pepsicojobs.com", "manufacturing", "medium", "medium"),
  target("intel", "Intel", "https://jobs.intel.com", "tech", "medium", "high"),
  target("procter-gamble", "Procter & Gamble", "https://www.pgcareers.com", "manufacturing", "medium", "high"),
  target("ibm", "IBM", "https://www.ibm.com/careers", "tech", "medium", "high"),
  target("disney", "Disney", "https://www.disneycareers.com", "operations", "medium", "high"),
  target("cisco", "Cisco", "https://jobs.cisco.com", "tech", "medium", "high"),
  target("oracle", "Oracle", "https://careers.oracle.com", "tech", "medium", "high"),
  target("nike", "Nike", "https://nike.wd1.myworkdayjobs.com/nike", "retail", "medium", "high"),
  target("morgan-stanley", "Morgan Stanley", "https://www.morganstanley.com/people-opportunities/students-graduates", "finance", "medium", "high"),
  target("goldman-sachs", "Goldman Sachs", "https://www.goldmansachs.com/careers", "finance", "medium", "high"),
  target("lockheed-martin", "Lockheed Martin", "https://www.lockheedmartinjobs.com", "manufacturing", "medium", "high"),
  target("boeing", "Boeing", "https://jobs.boeing.com", "manufacturing", "medium", "high"),
  target("caterpillar", "Caterpillar", "https://careers.caterpillar.com", "manufacturing", "medium", "medium"),
  target("honeywell", "Honeywell", "https://careers.honeywell.com", "manufacturing", "medium", "high"),
  target("rtx", "RTX", "https://careers.rtx.com", "manufacturing", "medium", "high"),
  target("deere", "John Deere", "https://www.deere.com/en/our-company/john-deere-careers", "manufacturing", "medium", "medium"),
  target("american-express", "American Express", "https://www.americanexpress.com/en-us/careers", "finance", "medium", "high"),
  target("salesforce", "Salesforce", "https://careers.salesforce.com", "tech", "medium", "high")
];

function target(
  id: string,
  company: string,
  careersUrl: string,
  category: JobSourceCategory,
  sponsorshipFriendly: SponsorshipFriendliness,
  competitionLevel: CompetitionLevel
): CompanyTarget {
  return {
    id,
    company,
    careersUrl,
    category,
    sponsorshipFriendly,
    competitionLevel,
    enabled: true
  };
}
