const PATTERNS: [string, RegExp][] = [
  ["email address", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ["account or card number", /\b\d(?:[ -]?\d){8,18}\b/],
  ["IBAN", /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/],
  ["PAN identifier", /\b[A-Z]{5}\d{4}[A-Z]\b/],
  ["credential", /\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|bearer)\b\s*[:=]?\s*\S+/i],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["phone number", /(?:\+\d{1,3}[ -]?)?\b\d{5}[ -]?\d{5}\b/],
];

/** Returns human-readable labels for restricted material found in free text. */
export function scanPrivacy(...texts: string[]): string[] {
  const joined = texts.join("\n");
  return PATTERNS.filter(([, re]) => re.test(joined)).map(([label]) => label);
}
