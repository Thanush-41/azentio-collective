export type EvidencePub = { id: string; approvedText: string; orgId: string; themeId: string | null };
export type ThemeRow = { id: string; title: string; topic: string; summary: string; suggestedImprovement: string; offering: string };
export const MIN_ORGANISATIONS = 3;

const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "for", "on", "is", "are", "what", "which", "do", "does", "how", "about", "with", "by", "any", "clients", "client"]);
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t));
const stem = (t: string) => t.replace(/(ality|ally|ing|ity|ies|es|s|al|ly)$/, "");

export function relevance(question: string, text: string) {
  const q = new Set(tokens(question).map(stem));
  return tokens(text).map(stem).filter(t => q.has(t)).length;
}

export type AiraAnswer =
  | { status: "answered"; mode: "deterministic_fallback"; theme: { id: string; title: string }; answer: string; suggestedImprovement: string;
      distinctOrganisations: number; references: string[] }
  | { status: "insufficient_evidence"; mode: "deterministic_fallback"; answer: string; references: [] };

/**
 * Deterministic, clearly-labelled synthesis over already-permitted evidence only.
 * Every returned reference is validated against the retrieved publication ids.
 */
export function answerQuestion(question: string, themes: ThemeRow[], pubs: EvidencePub[]): AiraAnswer {
  const insufficient: AiraAnswer = { status: "insufficient_evidence", mode: "deterministic_fallback", references: [],
    answer: "Insufficient approved evidence to answer this question across at least three organisations." };
  const scored = themes.map(t => ({ t, score: relevance(question, `${t.title} ${t.topic} ${t.summary}`) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  for (const { t } of scored) {
    const evidence = pubs.filter(p => p.themeId === t.id);
    const orgs = new Set(evidence.map(p => p.orgId)).size;
    if (orgs < MIN_ORGANISATIONS) continue;
    const retrieved = new Set(pubs.map(p => p.id));
    const references = evidence.map(p => p.id).filter(id => retrieved.has(id));
    if (references.length === 0) continue;
    return { status: "answered", mode: "deterministic_fallback", theme: { id: t.id, title: t.title }, answer: t.summary,
      suggestedImprovement: t.suggestedImprovement, distinctOrganisations: orgs, references };
  }
  return insufficient;
}
