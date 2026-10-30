import { expect, test } from "@playwright/test";
import { chooseWorkspace } from "./helpers";

for (const [path, heading] of [["/solutions", /Governed intelligence/], ["/insights", /Release notes/], ["/media", /recordings/], ["/about", /Intelligence built with/], ["/lab", /Where Azentio experiments/], ["/live", /Public sessions/], ["/register", /Create an account/]] as const) {
  test(`public route ${path} renders without the workspace chooser`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText("Choose a governed workspace")).toHaveCount(0);
  });
}

test("unknown workspace paths are a real 404; unentitled sandbox product is refused", async ({ page }) => {
  await chooseWorkspace(page, /Northstar Finance · client member/);
  const res = await page.goto("/client/not-a-page");
  expect(res?.status()).toBe(404);
  await page.goto("/client/sandbox?product=Compliance%20Intelligence");
  await expect(page.getByText(/not entitled to "Compliance Intelligence"/)).toBeVisible();
});

test("learning filters are visible and narrow the permitted results", async ({ page }) => {
  await chooseWorkspace(page, /Learning Moderator · moderator/);
  await page.goto("/learning");
  await page.getByRole("button", { name: /Load synthetic 3-organisation scenario/ }).click();
  await expect(page.getByText("3 distinct organisations")).toBeVisible();
  const filters = page.getByRole("form", { name: "Filter approved evidence" });
  await expect(filters.getByLabel("Offering")).toBeVisible();
  await expect(filters.getByLabel("Industry")).toBeVisible();
  await expect(filters.getByLabel("Region")).toBeVisible();
  await filters.getByLabel("Region").selectOption("Africa");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("Aggregation safeguard active")).toBeVisible();
  await filters.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("3 distinct organisations")).toBeVisible();
});
