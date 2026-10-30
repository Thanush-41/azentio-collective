import { expect, test } from "@playwright/test";
import { chooseWorkspace } from "./helpers";

test("unknown URLs are a genuine 404, known public URLs are 200, and the build commit is exposed", async ({ request }) => {
  expect((await request.get("/definitely-not-a-page")).status()).toBe(404);
  expect((await request.get("/client/not-a-page")).status()).toBe(404);
  expect((await request.get("/about")).status()).toBe(200);
  const v = await request.get("/api/version");
  expect(v.status()).toBe(200);
  expect(typeof (await v.json()).commit).toBe("string");
});

test("employee knowledge library: seeded article, search, owner/review date, feedback", async ({ page }) => {
  await chooseWorkspace(page, /Learning Moderator · moderator/);
  await page.request.post("/api/portal", { data: { action: "seed_scenario" } });
  await chooseWorkspace(page, /Azentio Employee · employee/);
  await page.goto("/employee/knowledge");
  await expect(page.getByText("Moderation redaction checklist")).toBeVisible();
  await expect(page.getByText("Learning governance team")).toBeVisible();
  await page.getByLabel("Search knowledge").fill("small-sample");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Interpreting small-sample themes")).toBeVisible();
  await expect(page.getByText("Moderation redaction checklist")).toHaveCount(0);
  await page.getByRole("button", { name: "Useful" }).click();
  await expect(page.getByText("Feedback recorded.")).toBeVisible();
  await expect(page.getByText("1 useful")).toBeVisible();
});

test("employee-only recording is gated at the media endpoint, not just hidden in the UI", async ({ page }) => {
  await chooseWorkspace(page, /Content Publisher · content publisher/);
  const create = await page.request.post("/api/portal", { data: { action: "create_content", kind: "recording", audience: "employee", title: "Internal demo recording", body: "Employees only session", mediaUrl: "https://example.com/internal-demo", publish: true } });
  expect(create.status()).toBe(201);
  const { id } = await create.json();
  const pub = await page.request.post("/api/portal", { data: { action: "create_content", kind: "recording", audience: "public", title: "Public demo recording", body: "Public session", mediaUrl: "https://example.com/public-demo", publish: true } });
  const publicId = (await pub.json()).id;

  await chooseWorkspace(page, /Azentio Employee · employee/);
  const employee = await page.request.get(`/api/media/${id}`, { maxRedirects: 0 });
  expect(employee.status()).toBe(302);
  expect(employee.headers().location).toBe("https://example.com/internal-demo");

  await chooseWorkspace(page, /Meridian Bank · client admin/);
  expect((await page.request.get(`/api/media/${id}`, { maxRedirects: 0 })).status()).toBe(404);
  const list = await (await page.request.get("/api/portal?scope=content")).json();
  expect(JSON.stringify(list)).not.toContain("example.com/internal-demo");

  const anon = await page.context().browser()!.newContext();
  expect((await anon.request.get(`/api/media/${id}`, { maxRedirects: 0 })).status()).toBe(401);
  expect((await anon.request.get(`/api/media/${publicId}`, { maxRedirects: 0 })).status()).toBe(302);
  const pubList = await (await anon.request.get("/api/public-content")).json();
  expect(JSON.stringify(pubList)).not.toContain("example.com");
  await anon.close();
});

test("support: client request → staff reply → client sees reply; audit trail visible to staff only", async ({ page }) => {
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/support");
  await page.getByLabel("Subject").fill("Sandbox rerun question");
  await page.getByLabel("Details").fill("How do I rerun the seasonal scenario?");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/Request sent/)).toBeVisible();
  expect((await page.request.get("/api/portal?scope=audit")).status()).toBe(403);

  await chooseWorkspace(page, /Azentio Employee · employee/);
  await page.goto("/employee/support");
  await page.getByPlaceholder("Reply to the organisation").first().fill("Use the Run button again.");
  await page.getByRole("button", { name: "Reply & close" }).first().click();

  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/support");
  await expect(page.getByText("Use the Run button again.")).toBeVisible();

  await chooseWorkspace(page, /Learning Moderator · moderator/);
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "support_reply" }).first()).toBeVisible();
});

test("saved searches can be reopened, renamed and deleted", async ({ page }) => {
  await chooseWorkspace(page, /Meridian Bank · client admin/);
  await page.goto("/client/learning");
  const filters = page.getByRole("form", { name: "Filter approved evidence" });
  await filters.getByLabel("Region").selectOption("India");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  page.once("dialog", d => d.accept("India view"));
  await page.getByRole("button", { name: "Save search" }).click();
  const saved = page.getByLabel("Saved searches");
  await expect(saved.getByRole("button", { name: "India view" })).toBeVisible();
  await filters.getByRole("button", { name: "Clear" }).click();
  await saved.getByRole("button", { name: "India view" }).click();
  await expect(filters.getByLabel("Region")).toHaveValue("India");
  page.once("dialog", d => d.accept("Renamed search"));
  await saved.getByRole("button", { name: "Rename" }).click();
  await expect(saved.getByRole("button", { name: "Renamed search" })).toBeVisible();
  await saved.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByLabel("Saved searches")).toHaveCount(0);
});

test("hackathon team space: progress, submission link and a team experiment", async ({ page }) => {
  await chooseWorkspace(page, /Azentio Employee · employee/);
  await page.goto("/employee/lab");
  await page.getByLabel("Team name").fill("Team Beta");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.locator("b", { hasText: "Team Beta" })).toBeVisible();
  const beta = page.getByRole("article").filter({ hasText: "Team Beta" });
  await beta.getByPlaceholder("Progress update").fill("Prototype running");
  await beta.getByPlaceholder("Submission link (https)").fill("https://example.com/beta");
  await beta.getByRole("button", { name: "Save team update" }).click();
  await expect(page.getByText("Prototype running").first()).toBeVisible();
  await expect(beta.getByRole("link", { name: "Submission link" })).toBeVisible();
  await page.getByLabel("Title").fill("Team experiment");
  await page.getByLabel("Hypothesis").fill("Seasonality hints improve explanations.");
  await page.getByLabel("Team (optional)").selectOption({ label: "Team Beta" });
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Experiment submitted.")).toBeVisible();
  await page.getByRole("button", { name: "Mark running" }).first().click();
  await expect(page.getByText("Experiment running.")).toBeVisible();
});
