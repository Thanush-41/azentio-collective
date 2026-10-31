import { stem, tokens } from "./aira";

/**
 * Lexical (TF-IDF cosine) similarity. Deliberately not an embedding model: it needs no external provider, so no shared or
 * private text leaves the deployment, and it is computed per request over currently retrievable records only — there is no
 * index to invalidate, so a withdrawn publication can never be suggested again.
 */
export type Doc = { id: string; text: string };
export type Match = { id: string; score: number };

const terms = (s: string) => tokens(s).map(stem);

function vectorise(docs: string[][]): Map<string, number>[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  return docs.map(d => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    for (const [t, c] of tf) v.set(t, (c / d.length) * (Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1));
    return v;
  });
}

export function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [t, w] of a) { na += w * w; const x = b.get(t); if (x) dot += w * x; }
  for (const w of b.values()) nb += w * w;
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Ranks corpus documents by similarity to the query. Scores are rounded to 2 dp; only scores >= min are returned. */
export function rankSimilar(query: string, corpus: Doc[], { min = 0.1, limit = 5 }: { min?: number; limit?: number } = {}): Match[] {
  if (!corpus.length) return [];
  const vecs = vectorise([terms(query), ...corpus.map(d => terms(d.text))]);
  const [q, ...rest] = vecs;
  return corpus.map((d, i) => ({ id: d.id, score: Math.round(cosine(q, rest[i]) * 100) / 100 }))
    .filter(m => m.score >= min).sort((a, b) => b.score - a.score).slice(0, limit);
}
