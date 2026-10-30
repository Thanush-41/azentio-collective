import { expect, test } from "@playwright/test";

test("create an account, sign out and back in; wrong password is rejected", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto("/signin");
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByRole("button", { name: /Create one/ }).click();
    await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel(/Password/).fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("button", { name: /Meridian Bank/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/signin/);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel(/Password/).fill("wrong password!!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Incorrect email or password")).toBeVisible();
  await page.getByLabel(/Password/).fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/login/);
});
