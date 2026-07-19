import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Theme = "light" | "dark";

const publicRoutes = [
  { name: "home", path: "/", title: "Misty - Home" },
  { name: "download", path: "/download", title: "Misty - Download" },
  { name: "pricing", path: "/pricing", title: "Misty - Pricing" },
  { name: "features", path: "/features", title: "Misty - Features" },
  { name: "changelog", path: "/changelog", title: "Misty - Changelog" },
  { name: "blog", path: "/blog", title: "Misty - Blog" },
  { name: "roadmap", path: "/roadmap", title: "Misty - Roadmap" },
  { name: "waitlist", path: "/waitlist", title: "Misty - Waitlist" },
  { name: "sign in", path: "/signin", title: "Misty - Sign In" },
  { name: "register", path: "/register", title: "Misty - Register" },
  { name: "tokenless reset", path: "/reset", title: "Misty - Reset Password" },
  { name: "not found", path: "/route-that-does-not-exist", title: "Misty - Not Found" },
] as const;

const themes: Theme[] = ["light", "dark"];

async function prepareApiLessPage(page: Page, theme: Theme) {
  await page.addInitScript((initialTheme) => {
    window.localStorage.clear();
    window.localStorage.setItem("misty-ui-theme", initialTheme);
  }, theme);

  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    });
  });
}

for (const route of publicRoutes) {
  for (const theme of themes) {
    test(`${route.name} renders accessibly in ${theme} mode`, async ({ page }) => {
      const pageErrors: Error[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));
      await prepareApiLessPage(page, theme);

      const response = await page.goto(route.path);

      expect(response?.ok(), `${route.path} should return a successful document`).toBe(true);
      await expect(page).toHaveTitle(route.title);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
      expect(pageErrors, `uncaught errors while rendering ${route.path}`).toEqual([]);

      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const violationSummary = accessibility.violations.flatMap(
        ({ id, impact, nodes }) =>
          nodes.map(
            ({ target, failureSummary }) =>
              `${id} (${impact ?? "unknown"}) at ${target.join(" > ")}: ${failureSummary ?? "no details"}`,
          ),
      );

      expect(violationSummary).toEqual([]);
    });
  }
}

test("settings redirects signed-out visitors without an API server", async ({ page }) => {
  await prepareApiLessPage(page, "dark");

  await page.goto("/settings");

  await expect(page).toHaveURL(/\/signin$/);
  await expect(page).toHaveTitle("Misty - Sign In");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
