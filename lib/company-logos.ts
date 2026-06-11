const companyDomains: Record<string, string> = {
  adobe: "adobe.com",
  affirm: "affirm.com",
  airbnb: "airbnb.com",
  amazon: "amazon.com",
  "american express": "americanexpress.com",
  anthropic: "anthropic.com",
  alphabet: "abc.xyz",
  apple: "apple.com",
  asml: "asml.com",
  "bank of america": "bankofamerica.com",
  "blue origin": "blueorigin.com",
  boeing: "boeing.com",
  cencora: "cencora.com",
  centene: "centene.com",
  "cardinal health": "cardinalhealth.com",
  caterpillar: "caterpillar.com",
  chevron: "chevron.com",
  cigna: "thecignagroup.com",
  cisco: "cisco.com",
  coinbase: "coinbase.com",
  costco: "costco.com",
  "cvs health": "cvshealth.com",
  cursor: "cursor.com",
  databricks: "databricks.com",
  "dell technologies": "dell.com",
  deloitte: "deloitte.com",
  disney: "disney.com",
  duolingo: "duolingo.com",
  "elevance health": "elevancehealth.com",
  exxonmobil: "exxonmobil.com",
  fedex: "fedex.com",
  figma: "figma.com",
  flexport: "flexport.com",
  ford: "ford.com",
  "general mills": "generalmills.com",
  "general motors": "gm.com",
  "goldman sachs": "goldmansachs.com",
  google: "google.com",
  honeywell: "honeywell.com",
  humana: "humana.com",
  ibm: "ibm.com",
  instacart: "instacart.com",
  intel: "intel.com",
  "johnson & johnson": "jnj.com",
  "johnson and johnson": "jnj.com",
  "john deere": "deere.com",
  "jpmorgan chase": "jpmorganchase.com",
  kroger: "kroger.com",
  "lockheed martin": "lockheedmartin.com",
  "lowe's": "lowes.com",
  lowes: "lowes.com",
  "marathon petroleum": "marathonpetroleum.com",
  mckesson: "mckesson.com",
  meta: "meta.com",
  microsoft: "microsoft.com",
  "morgan stanley": "morganstanley.com",
  netflix: "netflix.com",
  nike: "nike.com",
  notion: "notion.so",
  opendoor: "opendoor.com",
  oracle: "oracle.com",
  pepsico: "pepsico.com",
  perplexity: "perplexity.ai",
  "phillips 66": "phillips66.com",
  plaid: "plaid.com",
  "procter & gamble": "pg.com",
  "procter and gamble": "pg.com",
  "p&g": "pg.com",
  ramp: "ramp.com",
  rippling: "rippling.com",
  robinhood: "robinhood.com",
  rtx: "rtx.com",
  salesforce: "salesforce.com",
  samsara: "samsara.com",
  "scale ai": "scale.com",
  servicenow: "servicenow.com",
  snowflake: "snowflake.com",
  "state farm": "statefarm.com",
  stripe: "stripe.com",
  target: "target.com",
  tesla: "tesla.com",
  "the home depot": "homedepot.com",
  "home depot": "homedepot.com",
  uber: "uber.com",
  "unitedhealth group": "unitedhealthgroup.com",
  ups: "ups.com",
  valero: "valero.com",
  verkada: "verkada.com",
  verizon: "verizon.com",
  walgreens: "walgreens.com",
  walmart: "walmart.com",
  "walmart global tech": "walmart.com",
  waymo: "waymo.com",
  "wells fargo": "wellsfargo.com"
};

const simpleIconSlugs: Record<string, string> = {
  adobe: "adobe",
  affirm: "affirm",
  airbnb: "airbnb",
  amazon: "amazon",
  anthropic: "anthropic",
  apple: "apple",
  asml: "asml",
  "bank of america": "bankofamerica",
  boeing: "boeing",
  chevron: "chevron",
  cisco: "cisco",
  coinbase: "coinbase",
  costco: "costco",
  "cvs health": "cvshealth",
  cursor: "cursor",
  databricks: "databricks",
  "dell technologies": "dell",
  deloitte: "deloitte",
  disney: "disney",
  duolingo: "duolingo",
  exxonmobil: "exxonmobil",
  fedex: "fedex",
  figma: "figma",
  ford: "ford",
  "general motors": "generalmotors",
  "goldman sachs": "goldmansachs",
  google: "google",
  honeywell: "honeywell",
  ibm: "ibm",
  instacart: "instacart",
  intel: "intel",
  "john deere": "johndeere",
  "jpmorgan chase": "jpmorgan",
  "lockheed martin": "lockheedmartin",
  "lowe's": "lowes",
  lowes: "lowes",
  meta: "meta",
  microsoft: "microsoft",
  "morgan stanley": "morganstanley",
  netflix: "netflix",
  nike: "nike",
  notion: "notion",
  oracle: "oracle",
  pepsico: "pepsi",
  perplexity: "perplexity",
  plaid: "plaid",
  "procter & gamble": "procterandgamble",
  "procter and gamble": "procterandgamble",
  "p&g": "procterandgamble",
  ramp: "ramp",
  rippling: "rippling",
  robinhood: "robinhood",
  salesforce: "salesforce",
  samsara: "samsara",
  servicenow: "servicenow",
  snowflake: "snowflake",
  "state farm": "statefarm",
  stripe: "stripe",
  target: "target",
  tesla: "tesla",
  "the home depot": "homedepot",
  "home depot": "homedepot",
  uber: "uber",
  ups: "ups",
  verizon: "verizon",
  walgreens: "walgreens",
  walmart: "walmart",
  "wells fargo": "wellsfargo"
};

const suffixPattern = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|technologies|technology|systems|global|careers|jobs)\b/g;

export function getCompanyLogoUrls(company: string) {
  const domain = getCompanyDomain(company);
  if (!domain) return [];
  const iconSlug = getSimpleIconSlug(company);

  return [
    iconSlug ? `https://cdn.simpleicons.org/${iconSlug}` : "",
    `https://www.google.com/s2/favicons?domain=${domain}&sz=256`,
    `https://logo.clearbit.com/${domain}`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`
  ].filter(Boolean);
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
  const normalized = normalizeCompanyName(company);
  if (companyDomains[normalized]) return companyDomains[normalized];

  const simplified = simplifyCompanyName(normalized);
  if (companyDomains[simplified]) return companyDomains[simplified];

  const firstKnown = Object.keys(companyDomains).find((name) => {
    const simplifiedKnown = simplifyCompanyName(name);
    return simplified.includes(simplifiedKnown) || simplifiedKnown.includes(simplified);
  });
  if (firstKnown) return companyDomains[firstKnown];

  return inferCompanyDomain(simplified);
}

function getSimpleIconSlug(company: string) {
  const normalized = normalizeCompanyName(company);
  if (simpleIconSlugs[normalized]) return simpleIconSlugs[normalized];

  const simplified = simplifyCompanyName(normalized);
  if (simpleIconSlugs[simplified]) return simpleIconSlugs[simplified];

  const firstKnown = Object.keys(simpleIconSlugs).find((name) => {
    const simplifiedKnown = simplifyCompanyName(name);
    return simplified.includes(simplifiedKnown) || simplifiedKnown.includes(simplified);
  });
  return firstKnown ? simpleIconSlugs[firstKnown] : "";
}

function normalizeCompanyName(company: string) {
  return company
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simplifyCompanyName(company: string) {
  return company
    .replace(suffixPattern, "")
    .replace(/\bthe\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCompanyDomain(company: string) {
  const compact = company.replace(/[^a-z0-9]/g, "");
  if (compact.length < 3) return "";

  return `${compact}.com`;
}
