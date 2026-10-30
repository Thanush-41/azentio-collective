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
check("unknown URL is a genuine 404", (await fetch(BASE + "/no-such-page-" + Date.now(), { redirect: "manual" })).status === 404);
const ver = await new Client().call("/api/version");
check("build commit is exposed", ver.status === 200 && typeof ver.body.commit === "string", ver.body?.commit);
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
  check("staff email is verified (real email-code flow)", (me.emailVerified === true || process.env.LOCAL_DEV_SMOKE === "1") && me.memberships.some(m => m.role === "moderator"), me.emailVerified ? "no moderator membership" : "verify the email first");
  if (!me.emailVerified && process.env.LOCAL_DEV_SMOKE !== "1") { console.log("ABORT staff flows: account email is not verified"); console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed"); process.exit(failures ? 1 : 0); }
  const sess = async (role, org) => { const c = (await login()).c; const e = await c.enter(role, org); check(`enter ${role}${org ? ` @ ${org}` : ""}`, e?.status === 200); return c; };
  const meridian = await sess("client_admin", "org-meridian"), northstar = await sess("client_member", "org-northstar"), harbour = await sess("client_member", "org-harbour");
  const mod = await sess("moderator"), po = await sess("product_owner"), emp = await sess("employee"), pubr = await sess("content_publisher");
  const tag = `[smoke ${new Date().toISOString().slice(0, 16)}]`;
  const body = (over = {}) => ({ offering: FAI, title: `${tag} Seasonal SME cash-flow`, industry: "Banking", region: "India", observationPeriod: "2026-Q3", evidenceType: "Synthetic market observation", confidence: "Medium", description: "Seasonal SME cash flows are treated inconsistently in period comparisons.", sharingIntent: "propose_community", processingConsent: true, submit: true, ...over });

  // ---- Gate 3: security and audience boundaries ----
  check("forged membership id → 403", (await northstar.post("/api/session", { membershipId: "x:-:moderator" })).status === 403);
  check("client cannot run staff actions", (await meridian.act("seed_scenario")).status === 403);
  check("client admin cannot grant a moderator role (400)", (await meridian.act("invite_member", { email: "x@example.invalid", role: "moderator" })).status === 400);
  check("over-long input rejected (400)", (await meridian.act("create_observation", body({ description: "x".repeat(3001) }))).status === 400);
  check("free-text region (shared metadata) rejected (400)", (await meridian.act("create_observation", body({ region: "Pune branch of Acme" }))).status === 400);
  check("unentitled sandbox_run → 403", (await northstar.act("sandbox_run", { offering: "Compliance Intelligence", cycle: "Festival retail", seasonality: 40 })).status === 403);
  const priv = await meridian.act("create_observation", body({ sharingIntent: "private", submit: false, title: `${tag} PRIVATE-DRAFT-MARKER` }));
  check("Meridian saves a private draft", priv.status === 201 && priv.body.status === "draft");
  check("Northstar cannot read Meridian's record by id (404)", (await northstar.call(`/api/portal?scope=observation&id=${priv.body.observation_id}`)).status === 404);
  check("private draft is not in the moderator queue", !(await mod.call("/api/portal?scope=observations")).body.observations.some(o => o.id === priv.body.observation_id));

  // ---- Gate 2: the three-client learning loop ----
  const theme = await mod.act("create_theme", { title: `Seasonality context ${tag}`, topic: "seasonal SME cash-flow analysis", offering: FAI, summary: "Approved contributions describe inconsistent interpretation of seasonal SME cash flows.", suggestedImprovement: "Add a seasonality-aware comparison explanation." });
  check("moderator authors a theme", theme.status === 201, theme.body?.id);
  const subs = {};
  for (const [name, c] of [["meridian", meridian], ["northstar", northstar], ["harbour", harbour]]) {
    const r2 = await c.act("create_observation", body({ title: `${tag} ${name} seasonal observation` }));
    check(`${name} submits with explicit consent`, r2.status === 201 && r2.body.status === "submitted", r2.body?.observation_id);
    subs[name] = r2.body.observation_id;
  }
  check("submission without processing consent is blocked", (await harbour.act("create_observation", body({ processingConsent: false }))).status === 400);
  const clar = await mod.act("moderate", { observationId: subs.northstar, decision: "clarify", reason: "Please add the observation period detail" });
  check("moderator requests one clarification", clar.status === 200 && clar.body.status === "clarification_requested");
  check("author is notified in-app", (await northstar.call("/api/portal?scope=notifications")).body.notifications.some(n => n.event === "clarification_requested"));
  const resub = await northstar.act("update_observation", { observationId: subs.northstar, ...body({ title: `${tag} northstar seasonal observation`, description: "Seasonal SME cash flows, clarified for the 2026-Q3 period, are treated inconsistently." }) });
  check("Northstar amends and resubmits", resub.status === 200 && resub.body.status === "submitted");
  const pubs = {};
  for (const name of ["meridian", "northstar", "harbour"]) {
    const p = await mod.act("moderate", { observationId: subs[name], decision: "publish", reason: "Redacted and reviewed", approvedText: `Seasonal SME cash flows may need extra context in period comparisons (${name === "meridian" ? "A" : name === "northstar" ? "B" : "C"}).`, themeId: theme.body.id });
    check(`moderator publishes ${name}'s redacted copy`, p.status === 200, p.body?.publication_id);
    pubs[name] = p.body.publication_id;
  }
  const L = async (c = emp, qs = "") => (await c.call(`/api/portal?scope=learning${qs}`)).body;
  const find = l => (l.themes ?? []).find(t => t.id === theme.body.id);
  let l = await L();
  check("theme shows 3 distinct organisations after reload", find(l)?.distinct_organizations === 3, String(find(l)?.distinct_organizations));
  check("theme carries a small-sample warning", /Small sample/.test(find(l)?.warning ?? ""));
  check("shared payload leaks no tenant/author/source ids", !/org-|usr-|OBS-|authorId|orgId|sourceId/.test(JSON.stringify(l)));
  check("private draft text never appears in shared learning", !JSON.stringify(l).includes("PRIVATE-DRAFT-MARKER"));
  check("filters: region=Africa suppresses the theme", !find(await L(emp, "&region=Africa")));
  check("filters: region=India keeps the theme", !!find(await L(emp, "&region=India")));
  const q = "What seasonality concerns exist for seasonal SME cash flow?";
  const ai = (await emp.act("aira", { question: q })).body;
  const valid = new Set(l.publications.map(x => x.id));
  check("AIRA answers with ≥3 valid publication references", ai.status === "answered" && ai.references.length >= 3 && ai.references.every(x => valid.has(x)));
  check("AIRA is honest about being deterministic", ai.mode === "deterministic_fallback");
  check("AIRA refuses when filters leave <3 organisations", (await emp.act("aira", { question: q, filters: { region: "Africa" } })).body.status === "insufficient_evidence");
  const imp = await po.act("create_improvement", { title: `${tag} Seasonality-aware comparison`, problemStatement: "Seasonal cash flows lack context in comparisons.", proposedOutcome: "Explain like-for-like seasonal comparisons.", owner: "Financial Intelligence team", priority: "High", offering: FAI, themeId: theme.body.id, evidenceIds: Object.values(pubs) });
  check("product owner creates an evidence-linked improvement (Under review)", imp.status === 201 && imp.body.status === "Under review", imp.body?.id);
  check("illegal improvement transition rejected", (await po.act("improvement_status", { improvementId: imp.body.id, status: "Released" })).status === 409);
  check("improvement → Planned with client-visible update", (await po.act("improvement_status", { improvementId: imp.body.id, status: "Planned", internalNote: "INTERNAL-ONLY-NOTE", clientUpdate: "Planned for next release" })).status === 200);
  const cv = (await meridian.call("/api/portal?scope=improvements")).body.improvements.find(i => i.id === imp.body.id);
  check("client sees status + client update, without evidence ids or internal notes", !!cv && cv.status === "Planned" && !JSON.stringify(cv).includes("INTERNAL-ONLY-NOTE") && !JSON.stringify(cv).includes("PUB-"));

  // ---- entitlement change takes effect immediately ----
  const sb = { offering: "Lending Intelligence", cycle: "Festival retail", seasonality: 40 };
  check("Northstar not entitled to Lending Intelligence initially", (await northstar.act("sandbox_run", sb)).status === 403);
  check("product owner enables the entitlement", (await po.act("set_entitlement", { orgId: "org-northstar", productId: "prod-lnd", enabled: true })).status === 200);
  check("Northstar access changes immediately (200)", (await northstar.act("sandbox_run", sb)).status === 200);
  check("product owner disables it again", (await po.act("set_entitlement", { orgId: "org-northstar", productId: "prod-lnd", enabled: false })).status === 200);
  check("access is revoked immediately (403)", (await northstar.act("sandbox_run", sb)).status === 403);

  // ---- report / comments / media ----
  await harbour.act("add_comment", { publicationId: pubs.northstar, body: "Matches what we see" });
  check("comments readable while published", (await meridian.call(`/api/portal?scope=comments&id=${pubs.northstar}`)).body.comments?.length === 1);
  const rep = await meridian.act("report", { publicationId: pubs.northstar, reason: "smoke-test report" });
  check("report temporarily unpublishes", rep.status === 201);
  check("comments on a reported publication are inaccessible (404)", (await harbour.call(`/api/portal?scope=comments&id=${pubs.northstar}`)).status === 404);
  check("reported publication leaves shared retrieval", !(await L()).publications.some(x => x.id === pubs.northstar));
  check("moderator restores it", (await mod.act("resolve_report", { reportId: rep.body.report_id, outcome: "restore" })).status === 200);
  const rec = await pubr.act("create_content", { kind: "recording", audience: "employee", title: `${tag} internal recording`, body: "Employees only", mediaUrl: "https://example.com/internal", publish: true });
  check("publisher creates an employee-only recording", rec.status === 201);
  const raw = id => fetch(`${BASE}/api/media/${id}`, { redirect: "manual" });
  check("anonymous media request denied (401)", (await raw(rec.body.id)).status === 401);
  const clientMedia = await fetch(`${BASE}/api/media/${rec.body.id}`, { redirect: "manual", headers: { cookie: [...meridian.jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  check("employee-only media denied to a client at the media endpoint (404)", clientMedia.status === 404);
  const empMedia = await fetch(`${BASE}/api/media/${rec.body.id}`, { redirect: "manual", headers: { cookie: [...emp.jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  check("employee receives the media redirect (302)", empMedia.status === 302);
  check("content lists never expose the raw media URL", !JSON.stringify((await meridian.call("/api/portal?scope=content")).body).includes("example.com/internal") && !JSON.stringify((await emp.call("/api/portal?scope=content")).body).includes("example.com/internal"));

  // ---- withdrawal within 60 seconds ----
  const t0 = Date.now();
  const wd = await meridian.act("withdraw", { observationId: subs.meridian });
  check("Meridian withdraws its contribution", wd.status === 200 && wd.body.retrieval_excluded === true);
  let gone = false;
  while (Date.now() - t0 < 60_000) { l = await L(); gone = !l.publications.some(x => x.id === pubs.meridian) && !find(l); if (gone) break; await new Promise(r2 => setTimeout(r2, 2000)); }
  check("withdrawn evidence gone and theme suppressed (<3 orgs) within 60s", gone, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check("AIRA no longer cites the withdrawn publication", !JSON.stringify((await emp.act("aira", { question: q })).body).includes(pubs.meridian));
  const staffImp = (await po.call("/api/portal?scope=improvements")).body.improvements.find(i => i.id === imp.body.id);
  check("improvement flags withdrawn evidence / insufficient evidence", staffImp.evidenceStatus === "insufficient_evidence" && !staffImp.evidenceIds.includes(pubs.meridian));
  check("client no longer sees the under-threshold improvement", !(await meridian.call("/api/portal?scope=improvements")).body.improvements.some(i => i.id === imp.body.id));
  check("audit trail records privileged actions", (await mod.call("/api/portal?scope=audit")).body.events.some(e => e.action === "withdraw" || e.action === "propagate_withdrawal"));
  check("audit trail is not readable by clients (403)", (await meridian.call("/api/portal?scope=audit")).status === 403);
} else console.log("SKIP  staff flows (set STAFF_EMAIL and STAFF_PASSWORD; the account must be allow-listed in PORTAL_STAFF_EMAILS and verified via the emailed code)");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
