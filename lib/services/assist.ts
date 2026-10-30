import { and, eq, ne } from "drizzle-orm";
import { observations, publications, themeEvidence, themes } from "@/db/schema";
import { rankSimilar } from "@/lib/domain/similarity";
import { isModerationEligible } from "@/lib/domain/visibility";
import { ApiError, type Actor, type Db, auditStmt, requirePermission, runBatch } from "./core";

export const THEME_MIN_SCORE = 0.08;
export const DUPLICATE_MIN_SCORE = 0.45;

/**
 * Moderator assist for one submitted community proposal: suggested themes and possible duplicates.
 * Suggestions only — the moderator decides. Computed per request over currently published shared copies (no index), so withdrawn,
 * reported or re-reviewed publications are never suggested. Organisation identity is never returned: the moderator queue
 * deliberately hides it, and repeat posts from one organisation are already de-duplicated by the distinct-organisation count.
 */
export async function moderationAssist(db: Db, actor: Actor, observationId: string) {
  requirePermission(actor, "moderate");
  const [source] = await db.select().from(observations).where(eq(observations.id, observationId)).limit(1);
  if (!source || !isModerationEligible(source)) throw new ApiError("Submitted community proposal not found", 404);
  const query = `${source.title} ${source.description}`;

  const live = await db.select({ id: publications.id, approvedText: publications.approvedText }).from(publications)
    .innerJoin(observations, eq(publications.sourceId, observations.id))
    .where(and(eq(publications.status, "published"), eq(observations.status, "published")));
  const liveIds = new Set(live.map(p => p.id));
  const links = (await db.select().from(themeEvidence)).filter(l => liveIds.has(l.publicationId));
  const allThemes = await db.select().from(themes);
  const textOf = new Map(live.map(p => [p.id, p.approvedText]));

  const themeDocs = allThemes.map(t => ({ id: t.id,
    text: [t.title, t.topic, t.summary, ...links.filter(l => l.themeId === t.id).map(l => textOf.get(l.publicationId) ?? "")].join(" ") }));
  const themeSuggestions = rankSimilar(query, themeDocs, { min: THEME_MIN_SCORE, limit: 3 }).map(m => {
    const t = allThemes.find(x => x.id === m.id)!;
    return { themeId: t.id, title: t.title, score: m.score, linkedPublications: links.filter(l => l.themeId === t.id).length };
  });

  const duplicates = rankSimilar(query, live.map(p => ({ id: p.id, text: p.approvedText })), { min: DUPLICATE_MIN_SCORE, limit: 5 })
    .map(m => ({ publicationId: m.id, score: m.score, excerpt: (textOf.get(m.id) ?? "").slice(0, 160) }));

  const queue = await db.select({ id: observations.id, title: observations.title, description: observations.description }).from(observations)
    .where(and(eq(observations.status, "submitted"), eq(observations.sharingIntent, "propose_community"), ne(observations.id, source.id)));
  const pendingDuplicates = rankSimilar(query, queue.map(q => ({ id: q.id, text: `${q.title} ${q.description}` })), { min: DUPLICATE_MIN_SCORE, limit: 5 })
    .map(m => ({ observationId: m.id, score: m.score, title: queue.find(q => q.id === m.id)?.title ?? "" }));

  await runBatch(db, [auditStmt(db, actor.userId, "moderation_assist", source.id, `${themeSuggestions.length} theme(s), ${duplicates.length + pendingDuplicates.length} possible duplicate(s)`)]);
  return { method: "lexical_tfidf" as const,
    note: "Word-overlap similarity over currently published shared copies, computed per request. Suggestions only; the moderator decides.",
    themeSuggestions, duplicates, pendingDuplicates };
}
