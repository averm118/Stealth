const companyDomains: Record<string, string> = {
  adobe: "adobe.com",
  affirm: "affirm.com",
  airbnb: "airbnb.com",
  amazon: "amazon.com",
  "american express": "americanexpress.com",
  anthropic: "anthropic.com",
  asml: "asml.com",
  "blue origin": "blueorigin.com",
  boeing: "boeing.com",
  caterpillar: "caterpillar.com",
  coinbase: "coinbase.com",
  cursor: "cursor.com",
  databricks: "databricks.com",
  deloitte: "deloitte.com",
  duolingo: "duolingo.com",
  fedex: "fedex.com",
  figma: "figma.com",
  flexport: "flexport.com",
  "general mills": "generalmills.com",
  "general motors": "gm.com",
  honeywell: "honeywell.com",
  instacart: "instacart.com",
  intel: "intel.com",
  "johnson & johnson": "jnj.com",
  microsoft: "microsoft.com",
  netflix: "netflix.com",
  nike: "nike.com",
  notion: "notion.so",
  opendoor: "opendoor.com",
  perplexity: "perplexity.ai",
  plaid: "plaid.com",
  ramp: "ramp.com",
  rippling: "rippling.com",
  robinhood: "robinhood.com",
  samsara: "samsara.com",
  "scale ai": "scale.com",
  servicenow: "servicenow.com",
  snowflake: "snowflake.com",
  "state farm": "statefarm.com",
  stripe: "stripe.com",
  target: "target.com",
  tesla: "tesla.com",
  uber: "uber.com",
  verkada: "verkada.com",
  walmart: "walmart.com",
  "walmart global tech": "walmart.com",
  waymo: "waymo.com"
};

export function getCompanyLogoUrls(company: string) {
  const domain = getCompanyDomain(company);
  if (!domain) return [];

  return [
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://logo.clearbit.com/${domain}`
  ];
}

export function getCompanyLogoUrl(company: string) {
  return getCompanyLogoUrls(company)[0] ?? "";
}

export function getCompanyInitials(company: string) {
  return company
    .replace(/[^a-zA-Z0-9 &]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "ST";
}

function getCompanyDomain(company: string) {
  const normalized = company.toLowerCase().replace(/\s+/g, " ").trim();
  if (companyDomains[normalized]) return companyDomains[normalized];

  const simplified = normalized.replace(/\b(inc|llc|ltd|corp|corporation|company|technologies|technology)\b/g, "").replace(/\s+/g, " ").trim();
  if (companyDomains[simplified]) return companyDomains[simplified];

  const firstKnown = Object.keys(companyDomains).find((name) => simplified.includes(name) || name.includes(simplified));
  return firstKnown ? companyDomains[firstKnown] : "";
}
