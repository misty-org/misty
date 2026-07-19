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
