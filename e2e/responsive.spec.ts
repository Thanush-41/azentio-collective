import { expect, test } from "@playwright/test";
import { chooseWorkspace, noHorizontalScroll } from "./helpers";

const viewports = [{ name: "mobile", width: 390, height: 844 }, { name: "tablet", width: 820, height: 1180 }, { name: "desktop", width: 1440, height: 900 }];

for (const vp of viewports) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of ["/", "/products", "/connect", "/hackathon/register", "/login"]) {
      test(`public ${path} has no horizontal overflow`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("main, section").first()).toBeVisible();
        if (path === "/login") await expect(page.getByRole("button", { name: /Meridian Bank/ }).first()).toBeVisible();
        await noHorizontalScroll(page);
        await page.screenshot({ path: `e2e/screenshots/${vp.name}${path === "/" ? "-home" : path.replace(/\//g, "-")}.png`, fullPage: true });
      });
    }

    test("workspace navigation is reachable at this width", async ({ page }) => {
      await chooseWorkspace(page, /Meridian Bank · client admin/);
      await page.goto("/client/dashboard");
      const nav = page.getByRole("navigation", { name: "Workspace navigation" });
      const sidebar = page.locator("aside nav");
      await expect(vp.width < 1024 ? nav : sidebar).toBeVisible();
      if (vp.width < 1024) {
        // Every destination must sit fully inside the viewport (no clipping).
        for (const link of await nav.getByRole("link").all()) {
          const box = (await link.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
        }
      }
      await (vp.width < 1024 ? nav : sidebar).getByRole("link", { name: "My observations" }).click();
      await expect(page).toHaveURL(/\/client\/observations/);
    });

    test("client workspace pages have no horizontal overflow", async ({ page }) => {
      await chooseWorkspace(page, /Meridian Bank · client admin/);
      for (const path of ["/client/dashboard", "/client/observations", "/client/learning", "/client/members", "/client/updates"]) {
        await page.goto(path);
        await expect(page.locator("main").first()).toBeVisible();
        await noHorizontalScroll(page);
        await page.screenshot({ path: `e2e/screenshots/${vp.name}-${path.slice(1).replace(/\//g, "-")}.png`, fullPage: true });
      }
    });
  });
}
