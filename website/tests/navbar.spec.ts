import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.localStorage.setItem("misty-ui-theme", "dark");
  });
  await page.reload();
});

test("the navbar theme toggle persists across navigation and reload", async ({ page }) => {
  const toggle = page.getByRole("button", { name: "Switch to light theme" });
  await expect(toggle).toBeVisible();
  await toggle.click();

  await expect(page.locator("html")).toHaveClass(/(^|\s)light(\s|$)/);
  await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("misty-ui-theme"))).toBe("light");

  await page.getByRole("link", { name: "Misty home" }).click();
  await page.reload();

  await expect(page.locator("html")).toHaveClass(/(^|\s)light(\s|$)/);
  await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
});

test("the desktop theme toggle follows the sign-in control", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Desktop navigation is only rendered at the desktop breakpoint.",
  );

  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const signIn = navigation.getByRole("link", { name: "Sign in" });
  const toggle = navigation.getByRole("button", {
    name: "Switch to light theme",
  });
  await expect(signIn).toBeVisible();
  await expect(toggle).toBeVisible();

  const [signInBox, toggleBox] = await Promise.all([
    signIn.boundingBox(),
    toggle.boundingBox(),
  ]);

  expect(toggleBox?.x).toBeGreaterThan(signInBox?.x ?? Number.POSITIVE_INFINITY);
});

test("the primary links are limited to Download and Pricing", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  if (mobile) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }

  const linkContainer = mobile
    ? page.locator("#mobile-navigation")
    : page.getByRole("navigation", { name: "Primary navigation" });
  await expect(
    linkContainer.getByRole("link", { name: "Download", exact: true }),
  ).toBeVisible();
  const labels = await linkContainer
    .locator("a")
    .filter({ hasText: /^(Download|Pricing)$/ })
    .allTextContents();

  expect(labels).toEqual(["Download", "Pricing"]);
  await expect(
    linkContainer.getByRole("link", { name: "Features", exact: true }),
  ).toHaveCount(0);
});

test("page navigation mounts the destination with the entrance transition", async ({
  page,
}) => {
  const homePage = page.locator('[data-page-transition="/"]');
  await expect(homePage).toBeVisible();
  await expect(homePage).toHaveClass(/page-transition/);

  await page
    .getByRole("navigation", { name: "Explore footer links" })
    .getByRole("link", { name: "Pricing", exact: true })
    .click();

  await expect(page).toHaveURL(/\/pricing$/);
  const pricingPage = page.locator('[data-page-transition="/pricing"]');
  await expect(pricingPage).toBeVisible();
  await expect(homePage).toHaveCount(0);
  await expect(pricingPage).toHaveClass(/page-transition/);
});

test("the mobile menu opens, navigates, and closes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile navigation is only rendered at the mobile breakpoint.");

  const openMenu = page.getByRole("button", { name: "Open navigation menu" });
  await openMenu.click();

  await expect(page.getByRole("button", { name: "Close navigation menu" })).toBeVisible();
  await expect(page.locator("#mobile-navigation")).toBeVisible();

  await page.locator("#mobile-navigation").getByRole("link", { name: "Pricing" }).click();

  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator("#mobile-navigation")).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
});
