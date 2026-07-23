import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
});

test("the homepage tells the complete collaboration story", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Misty Space Library with shared research and files",
    }),
  ).toBeVisible();

  await expect(page.getByText("Message this Space")).toBeVisible();
  await expect(page.getByRole("link", { name: "View roadmap" })).toHaveAttribute(
    "href",
    "/roadmap",
  );
  await expect(page.getByRole("link", { name: "View blog" })).toHaveAttribute(
    "href",
    "/blog",
  );
});

test("the product templates are available without motion-dependent UI", async ({ page }) => {
  await expect(page.getByText("Launch plan").first()).toBeVisible();
  await expect(page.locator("video[autoplay]")).toHaveCount(0);
  await expect(page.locator("[data-scroll-stack-anchor], [data-scroll-stack-panel]")).toHaveCount(0);
  await expect(page.locator(".page-transition")).toHaveCount(0);
});

test("the homepage is complete, responsive, and free of horizontal overflow", async ({ page }) => {
  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const layout = await page.evaluate(() => ({
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    documentHeight: document.documentElement.scrollHeight,
    visibleText: document.body.innerText.length,
  }));

  expect(layout.hasHorizontalOverflow).toBe(false);
  expect(layout.documentHeight).toBeGreaterThan(page.viewportSize()!.height * 3);
  expect(layout.visibleText).toBeGreaterThan(600);
});

test("beta calls to action use the working request-access fallback", async ({ page }) => {
  const hero = page.locator("section").first();
  const betaLink = hero.getByRole("link", { name: "Request beta access" });
  await expect(betaLink).toHaveAttribute("href", "/waitlist");
  await betaLink.click();
  await expect(page).toHaveURL(/\/waitlist$/);
  await expect(page.getByRole("heading", { level: 1, name: /request beta access/i })).toBeVisible();
});
