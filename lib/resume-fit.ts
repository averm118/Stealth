export type CompleteReplacementSelection = {
  text: string;
  candidateIndex: number;
  usedAlternative: boolean;
};

export function selectCompleteReplacementCandidate(input: {
  replacement: string;
  replacementCandidates?: string[];
  maxChars?: number;
  transform?: (value: string) => string;
  accept?: (value: string) => boolean;
}): CompleteReplacementSelection | null {
  const transform = input.transform ?? cleanReplacementCandidate;
  const candidates = uniqueCandidates([
    input.replacement,
    ...(input.replacementCandidates ?? [])
  ]);
  const budget =
    typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
      ? Math.max(1, Math.round(input.maxChars))
      : undefined;

  for (let index = 0; index < candidates.length; index += 1) {
    const text = transform(candidates[index] ?? "");
    if (!text) continue;
    if (budget && text.length > budget) continue;
    if (input.accept && !input.accept(text)) continue;
    return {
      text,
      candidateIndex: index,
      usedAlternative: index > 0
    };
  }

  return null;
}

export function cleanReplacementCandidate(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function uniqueCandidates(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  values.forEach((value) => {
    const cleaned = cleanReplacementCandidate(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    output.push(cleaned);
  });

  return output;
}
