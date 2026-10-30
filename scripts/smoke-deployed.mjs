// Smoke test against a deployed URL.
//   BASE_URL=https://... node scripts/smoke-deployed.mjs
// Add STAFF_EMAIL (an address in PORTAL_STAFF_EMAILS) and STAFF_PASSWORD to also run the moderation / learning / improvement flow.
// With STAFF_EMAIL set, the account is created if missing, otherwise signed in.
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("BASE_URL is required");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };

class Client {
  jar = new Map();
  async call(path, init = {}) {
    const res = await fetch(BASE + path, { ...init, redirect: "manual", headers: { "Content-Type": "application/json", cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(init.headers ?? {}) } });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); const [k, v] = [kv.slice(0, i), kv.slice(i + 1)]; v ? this.jar.set(k, v) : this.jar.delete(k); }
    let body = null; try { body = await res.json(); } catch { /* non-json */ }
    return { status: res.status, body };
  }
  post(path, data) { return this.call(path, { method: "POST", body: JSON.stringify(data) }); }
  act(action, data = {}) { return this.post("/api/portal", { action, ...data }); }
  async signUpOrIn(email, password) {
    let r = await this.post("/api/auth", { mode: "signup", email, password, name: "Smoke Test" });
    if (r.status === 409) r = await this.post("/api/auth", { mode: "signin", email, password });
    return r;
  }
  async enter(role, orgId = null) {
    const { body } = await this.call("/api/session");
    const m = body.memberships.find(x => x.role === role && x.orgId === orgId);
    if (!m) return null;
    return this.post("/api/session", { membershipId: m.id });
  }
}

const home = await fetch(BASE + "/");
check("public home page loads without sign-in", home.status === 200, String(home.status));
const anon = await new Client().call("/api/session");
check("unauthenticated API call is rejected", anon.status === 401);

const pw = "correct horse battery";
const a = new Client(), b = new Client();
await a.signUpOrIn(`smoke-a-${Date.now()}@example.com`, pw);
await b.signUpOrIn(`smoke-b-${Date.now()}@example.com`, pw);
check("plain account has client workspaces only", (await a.call("/api/session")).body.memberships.every(m => m.kind === "client"));
check("forged staff membership id → 403", (await a.post("/api/session", { membershipId: "x:-:moderator" })).status === 403);
await a.enter("client_admin", "org-meridian");
await b.enter("client_member", "org-northstar");
check("client cannot run staff actions", (await a.act("seed_scenario")).status === 403);
check("client cannot read entitlement admin", (await a.call("/api/portal?scope=entitlement_matrix")).status === 403);
const bad = await a.act("create_observation", { offering: "FAI", title: "Title", industry: "Banking", region: "India", observationPeriod: "2026-Q3", evidenceType: "x", confidence: "Medium", description: "x".repeat(3001), sharingIntent: "private" });
check("over-long input rejected (400)", bad.status === 400);
const obs = await a.act("create_observation", { offering: "Financial Analysis Intelligence", title: "Seasonal SME cash-flow", industry: "Banking", region: "India", observationPeriod: "2026-Q3", evidenceType: "Synthetic", confidence: "Medium", description: "Seasonal variation is not reflected in the analysis.", sharingIntent: "organization", processingConsent: true });
check("Meridian creates an organisation observation", obs.status === 201, obs.body?.observation_id);
check("Northstar cannot read it by id (404)", (await b.call(`/api/portal?scope=observation&id=${obs.body.observation_id}`)).status === 404);
check("Northstar list excludes it", !(await b.call("/api/portal?scope=observations")).body.observations.some(o => o.id === obs.body.observation_id));
const sub = await a.act("create_observation", { offering: "Financial Analysis Intelligence", title: "Seasonal SME cash-flow", industry: "Banking", region: "India", observationPeriod: "2026-Q3", evidenceType: "Synthetic", confidence: "Medium", description: "Seasonal variation is not reflected in the analysis.", sharingIntent: "propose_community", processingConsent: true, submit: true });
check("submission queues for moderation, not public", sub.status === 201 && sub.body.status === "submitted" && sub.body.community_visible === false);
check("sandbox blocked without entitlement", (await b.act("sandbox_run", { offering: "Compliance Intelligence", cycle: "Festival retail", seasonality: 40 })).status === 403);
check("sandbox allowed with entitlement", (await b.act("sandbox_run", { offering: "Financial Analysis Intelligence", cycle: "Festival retail", seasonality: 40 })).status === 200);

if (process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD) {
  const s = new Client();
  const r = await s.signUpOrIn(process.env.STAFF_EMAIL, process.env.STAFF_PASSWORD);
  check("staff sign-in", r.status === 200);
  check("staff roles granted from allow-list", (await s.enter("moderator"))?.status === 200);
  const queue = (await s.call("/api/portal?scope=observations")).body.observations;
  check("moderator queue contains only community proposals", queue.length > 0 && queue.every(o => o.sharingIntent === "propose_community" && o.status === "submitted"));
  check("org-only record is not in the queue", !queue.some(o => o.id === obs.body.observation_id));
  const pub = await s.act("moderate", { observationId: sub.body.observation_id, decision: "publish", reason: "ok", approvedText: "Seasonal SME cash flows may need extra context." });
  check("moderator publishes", pub.status === 200, pub.body?.publication_id);
  check("seed scenario", (await s.act("seed_scenario")).status === 200);
  const l = (await s.call("/api/portal?scope=learning")).body;
  const json = JSON.stringify(l);
  check("shared payload leaks no tenant/author/source ids", !/org-|usr-|OBS-|authorId|orgId|sourceId/.test(json));
  check("theme visible at 3 organisations", l.theme?.distinct_organizations === 3, String(l.theme?.distinct_organizations));
  const ai = (await s.act("aira", { question: "What seasonality concerns exist?" })).body;
  const valid = new Set(l.publications.map(p => p.id));
  check("AIRA answers with valid references", ai.status === "answered" && ai.references.length > 0 && ai.references.every(x => valid.has(x)));
  await s.enter("product_owner");
  const imp = await s.act("create_improvement", { title: "Seasonality-aware comparison", problemStatement: "Seasonal cash flows lack context.", proposedOutcome: "Explain like-for-like comparisons.", owner: "FI product team", priority: "High", themeId: l.theme.id, evidenceIds: l.theme.supporting_publications });
  check("product owner creates evidence-linked improvement", imp.status === 201, imp.body?.id);
  const st = await s.act("improvement_status", { improvementId: imp.body.id, status: "Planned", clientUpdate: "Planned for next release" });
  check("improvement status transition", st.status === 200);
  check("illegal improvement transition rejected", (await s.act("improvement_status", { improvementId: imp.body.id, status: "Released" })).status === 409);
  const wd = await a.act("withdraw", { observationId: sub.body.observation_id });
  check("client withdraws published contribution", wd.status === 200 && wd.body.retrieval_excluded === true);
  await s.enter("employee");
  const after = (await s.call("/api/portal?scope=learning")).body;
  check("withdrawn publication no longer retrievable", !after.publications.some(p => p.id === pub.body.publication_id));
} else console.log("SKIP  staff flows (set STAFF_EMAIL and STAFF_PASSWORD)");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
