import { expect, test } from "@playwright/test";
import { chooseWorkspace } from "./helpers";

test("product owner administers entitlements and the client sees them", async ({ page }) => {
  await chooseWorkspace(page, /Product Owner · product owner/);
  await page.goto("/employee/entitlements");
  const box = page.getByRole("switch", { name: "Northstar Finance CMP" });
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  await chooseWorkspace(page, /Northstar Finance · client member/);
  await page.goto("/client/dashboard");
  await expect(page.getByText("Compliance Intelligence")).toBeVisible();
  // Restore so later tests start from the seeded entitlements.
  await chooseWorkspace(page, /Product Owner · product owner/);
  await page.goto("/employee/entitlements");
  await page.getByRole("switch", { name: "Northstar Finance CMP" }).click();
  await expect(page.getByRole("switch", { name: "Northstar Finance CMP" })).toHaveAttribute("aria-checked", "false");
});

test("moderator authors a theme", async ({ page }) => {
  await chooseWorkspace(page, /Learning Moderator · moderator/);
  await page.goto("/moderation/themes");
  await page.getByLabel("Title").fill("Regional context");
  await page.getByLabel("Topic").fill("regional analysis");
  await page.getByLabel("Summary").fill("Regional context matters for analysis quality.");
  await page.getByRole("button", { name: "Create theme" }).click();
  await expect(page.getByText("Regional context").first()).toBeVisible();
});

test("content publisher publishes a public release note that visitors see; employee content stays internal", async ({ page, browser }) => {
  await chooseWorkspace(page, /Content Publisher · content publisher/);
  await page.goto("/employee/content");
  const publish = async (audience: string, title: string) => {
    await page.getByLabel("Audience").selectOption(audience);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Body").fill("Body text for the update.");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published.")).toBeVisible();
  };
  await publish("public", "Release 1.4 notes");
  await publish("employee", "Internal all-hands");
  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await vp.goto("/");
  await expect(vp.getByText("Release 1.4 notes")).toBeVisible();
  await expect(vp.getByText("Internal all-hands")).toHaveCount(0);
  await visitor.close();
});

test("client admin grants and revokes support access", async ({ page }) => {
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/members");
  await page.getByLabel("Moderator email").fill("demo@local.test");
  await page.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(page.getByText(/SUP-.* active/)).toBeVisible();
  await page.getByRole("button", { name: "Revoke" }).last().click();
  await expect(page.getByText(/SUP-.* revoked/)).toBeVisible();
});

test("employee lab: experiment and team space", async ({ page }) => {
  await chooseWorkspace(page, /Azentio Employee · employee/);
  await page.goto("/employee/lab");
  await page.getByLabel("Title").fill("Seasonal prompt test");
  await page.getByLabel("Hypothesis").fill("Seasonality hints improve explanation quality.");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Experiment submitted.")).toBeVisible();
  await page.getByLabel("Team name").fill("Team Alpha");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.locator("b", { hasText: "Team Alpha" })).toBeVisible();
});

test("invitations: single-use link accepted by the intended email, revocable while pending", async ({ page }) => {
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/members");
  await page.getByLabel("Work email").fill("demo@local.test");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const linkBox = page.locator("div.font-mono");
  await expect(linkBox).toContainText("/accept-invite?token=");
  const link = (await linkBox.textContent())!.trim();
  await page.goto(new URL(link).pathname + new URL(link).search);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText(/You joined Meridian Bank/)).toBeVisible();
  await page.goto(new URL(link).pathname + new URL(link).search);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText(/invalid, used, revoked or expired/)).toBeVisible();
  await page.goto("/client/members");
  await page.getByLabel("Work email").fill("someone-else@example.invalid");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await page.getByRole("button", { name: "Revoke invitation" }).click();
  await expect(page.getByText("Invitation revoked.")).toBeVisible();
  await expect(page.getByText(/someone-else@example.invalid.*revoked/)).toBeVisible();
});
