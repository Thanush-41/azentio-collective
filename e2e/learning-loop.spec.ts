import { expect, test } from "@playwright/test";
import { chooseWorkspace } from "./helpers";

test.describe.configure({ mode: "serial" });

test("client submits, moderator publishes, learning shows the theme, withdrawal suppresses it", async ({ page }) => {
  // Client drafts then submits with consent.
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/observations");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByText(/· draft/)).toBeVisible();
  await page.getByRole("checkbox", { name: /I consent to storing and processing/ }).check();
  await page.getByRole("button", { name: /Submit for review/ }).click();
  await expect(page.getByText(/· submitted/)).toBeVisible();
  await expect(page.getByText("Awaiting moderation").first()).toBeVisible();
  await page.getByRole("button", { name: "Consent history" }).first().click();
  await expect(page.getByText(/model training · revoked/)).toBeVisible();

  // Moderator reviews and publishes; seed three-organisation scenario.
  await chooseWorkspace(page, /Learning Moderator · moderator/);
  await expect(page.getByText("Review queue · 1")).toBeVisible();
  await page.getByRole("button", { name: /Publish/ }).click();
  await expect(page.getByText(/→ published v1/)).toBeVisible();
  await page.getByRole("button", { name: /Load 3-org scenario/ }).click();
  await expect(page.getByText(/Scenario ready/)).toBeVisible();

  // Learning view: theme visible with references; AIRA answers with references.
  await page.goto("/learning");
  await expect(page.getByText("3 distinct organisations")).toBeVisible();
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".source").first()).toBeVisible();

  // Product owner creates an improvement from the approved theme.
  await chooseWorkspace(page, /Product Owner · product owner/);
  await page.goto("/employee/ideas");
  await page.getByRole("button", { name: /Create improvement idea/ }).click();
  await expect(page.getByText(/created and linked to PUB-/)).toBeVisible();
  await expect(page.getByText("Under review").first()).toBeVisible();

  // The Meridian administrator withdraws every Meridian record → only two organisations remain → theme suppressed.
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/observations");
  const withdraw = page.getByRole("button", { name: "Withdraw" });
  await expect(withdraw.first()).toBeVisible();
  while (await withdraw.count()) { const n = await withdraw.count(); await withdraw.first().click(); await expect(withdraw).toHaveCount(n - 1); }
  await page.goto("/client/learning");
  await expect(page.getByText("Aggregation safeguard active")).toBeVisible();
});

test("bell shows moderation and withdrawal notifications for the author", async ({ page }) => {
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/dashboard");
  await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText(/approved and shared with the community/)).toBeVisible();
  await expect(page.getByText(/withdrawn and excluded from future retrieval/).first()).toBeVisible();
});
