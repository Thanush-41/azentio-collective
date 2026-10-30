import { expect, test } from "@playwright/test";
import { chooseWorkspace } from "./helpers";

test("forged membership id cannot create a session", async ({ request }) => {
  const res = await request.post("/api/session", { data: { membershipId: "someone-else:-:moderator" } });
  expect(res.status()).toBe(403);
});

test("a client session cannot call moderator or product-owner actions or read another tenant", async ({ page }) => {
  await chooseWorkspace(page, /Northstar Finance · client member/);
  const call = (action: string, extra: object = {}) => page.request.post("/api/portal", { data: { action, ...extra } });
  expect((await call("seed_scenario")).status()).toBe(403);
  expect((await call("moderate", { observationId: "OBS-X1", decision: "publish", reason: "ok reason", approvedText: "Approved text here." })).status()).toBe(403);
  expect((await call("set_entitlement", { orgId: "org-northstar", productId: "prod-cmp", enabled: true })).status()).toBe(403);
  expect((await page.request.get("/api/portal?scope=entitlement_matrix")).status()).toBe(403);
  expect((await page.request.get("/api/portal?scope=observation&id=OBS-DOES-NOT-EXIST")).status()).toBe(404);
});

test("entitlement is enforced even when the sandbox URL is known", async ({ page }) => {
  await chooseWorkspace(page, /Northstar Finance · client member/);
  const res = await page.request.post("/api/portal", { data: { action: "sandbox_run", offering: "Compliance Intelligence", cycle: "Festival retail", seasonality: 40 } });
  expect(res.status()).toBe(403);
  await page.goto("/client/sandbox");
  await expect(page.getByText("Financial analysis playground")).toBeVisible();
});

test("validation rejects over-long input instead of truncating", async ({ page }) => {
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  const res = await page.request.post("/api/portal", { data: { action: "create_observation", offering: "FAI", title: "Title", industry: "Banking", region: "India", observationPeriod: "2026-Q3", evidenceType: "x", confidence: "Medium", description: "x".repeat(3001), sharingIntent: "private" } });
  expect(res.status()).toBe(400);
});

test("role-gated routes show access denied for the wrong role", async ({ page }) => {
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/moderation");
  await expect(page.getByText(/not authorised|Access/i).first()).toBeVisible();
});
