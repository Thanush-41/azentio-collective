import { expect, type Page } from "@playwright/test";

/** Selects a workspace the way a user does: through the membership list on /login. */
export async function chooseWorkspace(page: Page, label: RegExp | string) {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"));
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
