import type { WorkType } from "@/lib/types";

const stateAbbreviations: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY"
};

const stateCodes = new Set(Object.values(stateAbbreviations));
const countryTokens = new Set([
  "united states",
  "united states of america",
  "usa",
  "u.s.",
  "us",
  "canada",
  "germany",
  "india",
  "united kingdom",
  "uk"
]);
const nonLocationPattern =
  /\b(about|benefits|description|engineering interns|interns work|learn|offices|plants|refineries|renewables|responsibilities|requirements|salary|team|work mostly)\b/i;
const jobTitlePattern = /\b(analyst|engineer|intern|internship|manager|program|specialist|thesis)\b/i;

export function normalizeJobLocation(value: unknown, fallback = "") {
  const raw = cleanLocationText(value);
  if (!raw) return fallback;

  const directWorkType = getDirectWorkTypeLocation(raw);
  if (directWorkType) return directWorkType;

  const commaLocation = formatCommaLocation(raw);
  if (commaLocation) return commaLocation;

  const pieces = raw
    .split(/\s*(?:\||\/|•|·|;|\n|\r)\s*/g)
    .map((part) => formatCommaLocation(part) || cleanLocationPart(part))
    .filter((part): part is string => Boolean(part));

  return summarizeLocations(unique(pieces), fallback);
}

export function getDisplayJobLocation(location: unknown, workType?: WorkType) {
  const normalized = normalizeJobLocation(location, "");
  if (!normalized || normalized === "Not specified") return "";
  if (workType && normalized.toLowerCase() === workType.toLowerCase()) return "";
  return normalized;
}

function cleanLocationText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function getDirectWorkTypeLocation(value: string) {
  const normalized = value.toLowerCase();
  if (/^remote(?:\s*[-/]\s*(?:us|usa|united states))?$/i.test(value)) return "Remote";
  if (/^hybrid$/i.test(value)) return "Hybrid";
  if (/^(on[- ]?site|onsite)$/i.test(value)) return "On-site";
  if (normalized === "not specified") return "Not specified";
  return "";
}

function formatCommaLocation(value: string) {
  const text = cleanLocationText(value);
  if (!text || hasScrapeNoise(text)) return "";
  if (!text.includes(",") && !hasStateCode(text)) return cleanLocationPart(text);

  const tokens = text
    .split(",")
    .map((token) => cleanLocationPart(token))
    .filter((token): token is string => Boolean(token));
  if (!tokens.length) return "";

  const locations: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isCountry(token) || isState(token)) continue;

    const next = tokens[index + 1];
    const afterNext = tokens[index + 2];
    if (next && isState(next)) {
      locations.push(`${toDisplayCase(token)}, ${formatState(next)}`);
      index += afterNext && isCountry(afterNext) ? 2 : 1;
      continue;
    }
    if (next && afterNext && isCountry(afterNext) && looksLikePlace(next)) {
      locations.push(`${toDisplayCase(token)}, ${toDisplayCase(next)}`);
      index += 2;
      continue;
    }
    if (next && isCountry(next)) {
      locations.push(toDisplayCase(token));
      index += 1;
      continue;
    }
    if (looksLikePlace(token)) locations.push(toDisplayCase(token));
  }

  return summarizeLocations(unique(locations), "");
}

function cleanLocationPart(value: string) {
  const text = cleanLocationText(value)
    .replace(/^\W+|\W+$/g, "")
    .replace(/\bUnited States(?: of America)?\b/gi, "United States")
    .trim();
  if (!text || hasScrapeNoise(text) || jobTitlePattern.test(text)) return "";
  if (isCountry(text)) return "";
  if (isState(text)) return formatState(text);
  if (!looksLikePlace(text) && !hasStateCode(text)) return "";
  return toDisplayCase(text);
}

function summarizeLocations(locations: string[], fallback: string) {
  const visible = locations.filter((location) => location && location !== "United States");
  if (!visible.length) return fallback;
  if (visible.length === 1) return visible[0];
  return `${visible[0]} +${visible.length - 1}`;
}

function hasScrapeNoise(value: string) {
  const sentenceCount = (value.match(/[.!?]/g) ?? []).length;
  return sentenceCount > 0 || nonLocationPattern.test(value);
}

function looksLikePlace(value: string) {
  return /^[a-zA-Z][a-zA-Z .'-]{1,44}$/.test(value) && !nonLocationPattern.test(value);
}

function hasStateCode(value: string) {
  return /\b[A-Z]{2}\b/.test(value) && [...stateCodes].some((code) => new RegExp(`\\b${code}\\b`).test(value));
}

function isState(value: string) {
  const normalized = value.toLowerCase();
  return stateCodes.has(value.toUpperCase()) || Boolean(stateAbbreviations[normalized]);
}

function formatState(value: string) {
  return stateCodes.has(value.toUpperCase()) ? value.toUpperCase() : stateAbbreviations[value.toLowerCase()] ?? value;
}

function isCountry(value: string) {
  return countryTokens.has(value.toLowerCase());
}

function toDisplayCase(value: string) {
  if (stateCodes.has(value.toUpperCase())) return value.toUpperCase();
  return value
    .split(" ")
    .map((word) => {
      if (stateCodes.has(word.toUpperCase())) return word.toUpperCase();
      if (/^[A-Z]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
