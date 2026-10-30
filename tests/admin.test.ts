import { beforeEach, describe, expect, it } from "vitest";
import type { Actor, Db } from "@/lib/services/core";
import * as adm from "@/lib/services/admin";
import * as learn from "@/lib/services/learning";
import * as obs from "@/lib/services/observations";
import { provisionUser } from "@/lib/services/identity";
import { CLOSED, createTestDb, obsInput, signIn } from "./helpers";

let db: Db;
let meridian: Actor, northstar: Actor, moderator: Actor, owner: Actor, employee: Actor, publisher: Actor;
const code = (e: unknown) => (e as { status?: number }).status;

beforeEach(async () => {
  db = await createTestDb();
  meridian = await signIn(db, "u-meridian", "client_admin", "org-meridian");
  northstar = await signIn(db, "u-north", "client_member", "org-northstar");
  moderator = await signIn(db, "u-mod", "moderator");
  owner = await signIn(db, "u-owner", "product_owner");
  employee = await signIn(db, "u-emp", "employee");
  publisher = await signIn(db, "u-pub", "content_publisher");
});

describe("theme authoring and entitlement admin", () => {
  it("moderators author themes and link only published evidence; clients cannot", async () => {
    await expect(adm.createTheme(db, meridian, { title: "t", topic: "topic", offering: "FAI", summary: "long enough summary", suggestedImprovement: "" })).rejects.toSatisfy(e => code(e) === 403);
    const { id } = await adm.createTheme(db, moderator, { title: "Regional context", topic: "regional", offering: "FAI", summary: "Regional context matters for analysis.", suggestedImprovement: "" });
    await expect(adm.linkEvidence(db, moderator, id, "PUB-NOPE")).rejects.toSatisfy(e => code(e) === 404);
    const { observation_id } = await obs.createObservation(db, meridian, obsInput(), true);
    const { publication_id } = await obs.moderate(db, moderator, { observationId: observation_id, decision: "publish", reason: "ok", approvedText: "Regional context observation.", acknowledgeFlags: false });
    await adm.linkEvidence(db, moderator, id, publication_id as string);
    expect((await adm.listThemesAdmin(db, moderator)).find(t => t.id === id)?.evidenceCount).toBe(1);
  });
  it("only product owners administer entitlements", async () => {
    await expect(adm.entitlementMatrix(db, moderator)).rejects.toSatisfy(e => code(e) === 403);
    await expect(learn.setEntitlement(db, employee, "org-northstar", "prod-cmp", true)).rejects.toSatisfy(e => code(e) === 403);
    expect((await adm.entitlementMatrix(db, owner)).entitlements.length).toBeGreaterThan(0);
  });
});

describe("audited support authorisation", () => {
  it("moderators read a non-private record only under an active, client-granted, unrevoked grant", async () => {
    const { observation_id } = await obs.createObservation(db, meridian, obsInput({ sharingIntent: "organization" }), false);
    await expect(obs.getObservation(db, moderator, observation_id)).rejects.toSatisfy(e => code(e) === 404);
    await expect(adm.grantSupportAccess(db, northstar, { email: "u-mod@test.dev", hours: 2 })).rejects.toSatisfy(e => code(e) === 403);
    await provisionUser(db, { userId: "u-plain", email: "plain@x.dev" }, CLOSED);
    await expect(adm.grantSupportAccess(db, meridian, { email: "plain@x.dev", hours: 2 })).rejects.toSatisfy(e => code(e) === 400);
    const g = await adm.grantSupportAccess(db, meridian, { email: "u-mod@test.dev", hours: 2 });
    await expect(obs.getObservation(db, moderator, observation_id)).resolves.toMatchObject({ id: observation_id });
    const priv = await obs.createObservation(db, meridian, obsInput({ sharingIntent: "private" }), false);
    await expect(obs.getObservation(db, moderator, priv.observation_id)).rejects.toSatisfy(e => code(e) === 404);
    await adm.revokeSupportAccess(db, meridian, g.id);
    await expect(obs.getObservation(db, moderator, observation_id)).rejects.toSatisfy(e => code(e) === 404);
  });
});

describe("content audiences and publisher permission", () => {
  it("only publishers publish; employee content never reaches clients; org resources are tenant-scoped", async () => {
    const input = { kind: "broadcast", audience: "employee", title: "All hands", body: "Internal broadcast body" };
    await expect(adm.createContent(db, employee, input, true)).rejects.toSatisfy(e => code(e) === 403);
    await adm.createContent(db, publisher, input, true);
    await adm.createContent(db, publisher, { kind: "release_note", audience: "public", title: "v1.2", body: "Public release note" }, true);
    await adm.createContent(db, publisher, { kind: "resource", audience: "client", orgId: "org-meridian", title: "Meridian guide", body: "Tenant resource body" }, true);
    await adm.createContent(db, publisher, { kind: "knowledge", audience: "client", title: "Draft", body: "Unpublished draft" }, false);
    const titles = async (a: Actor) => (await adm.listContent(db, a)).map(i => i.title).sort();
    expect(await titles(meridian)).toEqual(["Meridian guide", "v1.2"]);
    expect(await titles(northstar)).toEqual(["v1.2"]);
    expect(await titles(employee)).toEqual(["All hands", "v1.2"]);
    expect((await adm.publicContent(db)).map(i => i.title)).toEqual(["v1.2"]);
    await expect(adm.createContent(db, publisher, { kind: "resource", audience: "public", orgId: "org-meridian", title: "bad", body: "bad body here" }, true)).rejects.toSatisfy(e => code(e) === 400);
  });
});

describe("QA-09 / QA-10", () => {
  it("comments are unreadable once the parent publication is reported or withdrawn", async () => {
    await learn.seedScenario(db, moderator);
    const [pub] = (await learn.getLearning(db, employee)).publications;
    await adm.addComment(db, meridian, pub.id, "Matches what we see");
    expect(await adm.listComments(db, northstar, pub.id)).toHaveLength(1);
    await obs.reportPublication(db, northstar, pub.id, "looks identifying");
    await expect(adm.listComments(db, northstar, pub.id)).rejects.toSatisfy(e => code(e) === 404);
    await expect(adm.addComment(db, northstar, pub.id, "more")).rejects.toSatisfy(e => code(e) === 404);
  });
  it("media links are accepted only on recordings", async () => {
    const base = { audience: "employee", title: "Session", body: "Body of the session.", mediaUrl: "https://example.com/v" };
    await expect(adm.createContent(db, publisher, { ...base, kind: "broadcast" }, true)).rejects.toSatisfy(e => code(e) === 400);
    await adm.createContent(db, publisher, { ...base, kind: "recording" }, true);
    expect((await adm.listContent(db, employee)).find(i => i.kind === "recording")?.mediaUrl).toBe("https://example.com/v");
    expect((await adm.listContent(db, meridian)).some(i => i.kind === "recording")).toBe(false);
  });
});

describe("bookmarks, comments, lab", () => {
  it("bookmarks are per user; comments show role labels only; teams and experiments work", async () => {
    await learn.seedScenario(db, moderator);
    const pub = (await learn.getLearning(db, employee)).publications[0].id;
    const b = await adm.addBookmark(db, meridian, { kind: "publication", ref: pub, label: "Useful" });
    expect(await adm.listBookmarks(db, northstar)).toHaveLength(0);
    await expect(adm.removeBookmark(db, northstar, b.id)).rejects.toSatisfy(e => code(e) === 404);
    await adm.addBookmark(db, meridian, { kind: "search", ref: "region=India", label: "India" });
    await adm.addComment(db, meridian, pub, "Matches what we see");
    const cs = await adm.listComments(db, northstar, pub);
    expect(JSON.stringify(cs)).not.toMatch(/Meridian|org-|u-meridian/);
    expect(cs[0].authorLabel).toBe("Client contributor");
    await expect(adm.submitExperiment(db, meridian, { title: "Exp", hypothesis: "A long enough hypothesis." })).rejects.toSatisfy(e => code(e) === 403);
    await adm.submitExperiment(db, employee, { title: "Exp", hypothesis: "A long enough hypothesis." });
    const { id } = await adm.createTeam(db, employee, { name: "Team Alpha", brief: "" });
    await adm.joinTeam(db, owner, id);
    expect((await adm.listTeams(db, owner))[0]).toMatchObject({ members: 2, joined: true });
  });
});
