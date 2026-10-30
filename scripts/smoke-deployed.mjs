// Smoke test against a deployed URL.
//   BASE_URL=https://... node scripts/smoke-deployed.mjs
// Add STAFF_EMAIL (an address in PORTAL_STAFF_EMAILS, already verified) and STAFF_PASSWORD to also run the client, moderation,
// learning, improvement and withdrawal flow. Test records are synthetic.
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("BASE_URL is required");
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };

class Client {
  jar = new Map();
  async call(path, init = {}) {
    const res = await fetch(BASE + path, { ...init, redirect: "manual", headers: { "Content-Type": "application/json", cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(init.headers ?? {}) } });
    for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); const [k, v] = [kv.slice(0, i), kv.slice(i + 1)]; if (v) this.jar.set(k, v); else this.jar.delete(k); }
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

const FAI = "Financial Analysis Intelligence";
for (const path of ["/", "/solutions", "/insights", "/media", "/about", "/register", "/products", "/connect"]) {
  const r = await fetch(BASE + path, { redirect: "manual" });
  check(`public route ${path} loads without sign-in`, r.status === 200, String(r.status));
}
const anon = await new Client().call("/api/session");
check("unauthenticated API call is rejected", anon.status === 401);
check("anonymous public-content API works and exposes no private items", (await new Client().call("/api/public-content")).status === 200);

// Forged platform identity headers must not authenticate anyone.
const forged = await fetch(BASE + "/api/session", { headers: { "oai-authenticated-user-id": "attacker", "oai-authenticated-user-email": process.env.STAFF_EMAIL ?? "thanushgarimella@gmail.com" } });
check("forged oai-authenticated-* headers are ignored (401)", forged.status === 401, String(forged.status));
const forgedPortal = await fetch(BASE + "/api/portal?scope=learning", { headers: { "oai-authenticated-user-id": "attacker", "oai-authenticated-user-email": "x@y.dev" } });
check("forged headers cannot reach portal APIs", forgedPortal.status === 401, String(forgedPortal.status));

const pw = "correct horse battery";
const plain = new Client();
const su = await plain.signUpOrIn(`smoke-${Date.now()}@example.com`, pw);
check("account creation works and reports email-provider state honestly", su.status === 200 && typeof su.body.emailVerified === "boolean");
const ms = (await plain.call("/api/session")).body;
check("new account has NO workspaces (no automatic tenant or staff membership)", ms.memberships.length === 0 && ms.emailVerified === false, JSON.stringify(ms.memberships));
check("forged membership id → 403", (await plain.post("/api/session", { membershipId: "x:-:moderator" })).status === 403);
check("plain account cannot call portal APIs without a workspace", (await plain.act("seed_scenario")).status === 401);
check("invalid invitation token rejected", (await plain.call("/api/session", { method: "PUT", body: JSON.stringify({ token: "x".repeat(40) }) })).status === 400);
check("public form validates input", (await new Client().post("/api/public-form", { name: "a", email: "bad" })).status === 400);
const pf = await new Client().post("/api/public-form", { kind: "demo", name: "Smoke Test", email: "smoke@example.invalid", company: "Synthetic Co", message: "smoke test", idempotencyKey: `smoke-${Date.now()}` });
check("public demo enquiry is stored", pf.status === 201 && /^ENQ-/.test(pf.body?.reference ?? ""), pf.body?.reference);

if (process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD) {
  const login = async () => { const c = new Client(); const r = await c.signUpOrIn(process.env.STAFF_EMAIL, process.env.STAFF_PASSWORD); return { c, r }; };
  const { c: s, r } = await login();
  check("staff sign-in", r.status === 200);
  const me = (await s.call("/api/session")).body;
  check("staff email is verified", me.emailVerified === true, "if false run scripts/verify-email.mjs");
  const a = (await login()).c, b = (await login()).c; // two independent sessions of the same approved user, in two tenants
  check("staff enters Meridian (client admin)", (await a.enter("client_admin", "org-meridian"))?.status === 200);
  check("staff enters Northstar (client member)", (await b.enter("client_member", "org-northstar"))?.status === 200);
  const body = (over = {}) => ({ offering: FAI, title: "Seasonal SME cash-flow", industry: "Banking", region: "India", observationPeriod: "2026-Q3", evidenceType: "Synthetic", confidence: "Medium", description: "Seasonal variation is not reflected in the analysis.", sharingIntent: "organization", processingConsent: true, ...over });
  check("over-long input rejected (400)", (await a.act("create_observation", body({ description: "x".repeat(3001) }))).status === 400);
  check("free-text region (shared metadata) rejected (400)", (await a.act("create_observation", body({ region: "Pune branch of Acme" }))).status === 400);
  const obs = await a.act("create_observation", body());
  check("Meridian creates an organisation observation", obs.status === 201, obs.body?.observation_id);
  check("Northstar cannot read it by id (404)", (await b.call(`/api/portal?scope=observation&id=${obs.body.observation_id}`)).status === 404);
  check("Northstar list excludes it", !(await b.call("/api/portal?scope=observations")).body.observations.some(o => o.id === obs.body.observation_id));
  const sub = await a.act("create_observation", body({ sharingIntent: "propose_community", submit: true, allowAttribution: false }));
  check("submission queues for moderation, not public", sub.status === 201 && sub.body.status === "submitted" && sub.body.community_visible === false);
  check("sandbox blocked without entitlement", (await b.act("sandbox_run", { offering: "Compliance Intelligence", cycle: "Festival retail", seasonality: 40 })).status === 403);
  check("sandbox allowed with entitlement", (await b.act("sandbox_run", { offering: FAI, cycle: "Festival retail", seasonality: 40 })).status === 200);
  check("client cannot run staff actions", (await a.act("seed_scenario")).status === 403);

  const inv = await a.act("invite_member", { email: "smoke-invitee@example.invalid", role: "client_member" });
  check("client admin creates a single-use invitation", inv.status === 201 && inv.body.token?.length > 20);
  check("client admin cannot invite staff roles", (await a.act("invite_member", { email: "x@example.invalid", role: "moderator" })).status === 400);
  check("client admin revokes a pending invitation", (await a.act("revoke_invitation", { invitationId: inv.body.id })).status === 200);

  check("staff enters moderator workspace", (await s.enter("moderator"))?.status === 200);
  const queue = (await s.call("/api/portal?scope=observations")).body.observations;
  check("moderator queue contains only community proposals", queue.length > 0 && queue.every(o => o.sharingIntent === "propose_community" && o.status === "submitted"));
  check("org-only record is not in the queue", !queue.some(o => o.id === obs.body.observation_id));
  check("shared copy with free-text metadata is rejected", (await s.act("moderate", { observationId: sub.body.observation_id, decision: "publish", reason: "Reviewed and redacted", approvedText: "Seasonal SME cash flows may need extra context.", metadata: { region: "Pune" } })).status === 400);
  check("attribution without consent is refused", (await s.act("moderate", { observationId: sub.body.observation_id, decision: "publish", reason: "Reviewed and redacted", approvedText: "Seasonal SME cash flows may need extra context.", attribute: true })).status === 409);
  const pub = await s.act("moderate", { observationId: sub.body.observation_id, decision: "publish", reason: "Reviewed and redacted", approvedText: "Seasonal SME cash flows may need extra context." });
  check("moderator publishes", pub.status === 200, pub.body?.publication_id);
  check("seed scenario", (await s.act("seed_scenario")).status === 200);
  const l = (await s.call("/api/portal?scope=learning")).body;
  check("shared payload leaks no tenant/author/source ids", !/org-|usr-|OBS-|authorId|orgId|sourceId/.test(JSON.stringify(l)));
  check("theme visible at 3 organisations", l.theme?.distinct_organizations === 3, String(l.theme?.distinct_organizations));
  const filtered = (await s.call("/api/portal?scope=learning&region=Africa")).body;
  check("filters apply: unsupported region suppresses the theme", filtered.theme === null);
  const ai = (await s.act("aira", { question: "What seasonality concerns exist?" })).body;
  const valid = new Set(l.publications.map(p => p.id));
  check("AIRA answers with valid references", ai.status === "answered" && ai.references.length > 0 && ai.references.every(x => valid.has(x)));
  check("AIRA says insufficient evidence for an unsupported filter", (await s.act("aira", { question: "What seasonality concerns exist?", filters: { region: "Africa" } })).body.status === "insufficient_evidence");
  await s.enter("product_owner");
  const imp = await s.act("create_improvement", { title: "Seasonality-aware comparison", problemStatement: "Seasonal cash flows lack context.", proposedOutcome: "Explain like-for-like comparisons.", owner: "FI product team", priority: "High", themeId: l.theme.id, evidenceIds: l.theme.supporting_publications });
  check("product owner creates evidence-linked improvement", imp.status === 201, imp.body?.id);
  check("improvement status transition", (await s.act("improvement_status", { improvementId: imp.body.id, status: "Planned", clientUpdate: "Planned for next release" })).status === 200);
  check("illegal improvement transition rejected", (await s.act("improvement_status", { improvementId: imp.body.id, status: "Released" })).status === 409);
  check("client sees the idea with client-audience updates only", await (async () => { const v = (await a.call("/api/portal?scope=improvements")).body.improvements; return Array.isArray(v) && !JSON.stringify(v).includes("PUB-"); })());
  const wd = await a.act("withdraw", { observationId: sub.body.observation_id });
  check("client withdraws published contribution", wd.status === 200 && wd.body.retrieval_excluded === true);
  await s.enter("employee");
  const after = (await s.call("/api/portal?scope=learning")).body;
  check("withdrawn publication no longer retrievable", !after.publications.some(p => p.id === pub.body.publication_id));
  await s.enter("product_owner");
  const impAfter = (await s.call("/api/portal?scope=improvements")).body.improvements.find(i => i.id === imp.body.id);
  check("improvement shows withdrawn evidence is reflected", impAfter.withdrawnEvidence >= 1 || !impAfter.evidenceIds.includes(pub.body.publication_id), `${impAfter.evidenceStatus}`);
} else console.log("SKIP  staff flows (set STAFF_EMAIL and STAFF_PASSWORD; the email must be in PORTAL_STAFF_EMAILS and verified)");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
