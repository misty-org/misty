import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Theme = "light" | "dark";

const publicRoutes = [
  {
    name: "home",
    path: "/",
    title: "Misty — The operating system for human and agent work",
  },
  {
    name: "download",
    path: "/download",
    title: "Download Misty — macOS and Windows beta",
  },
  {
    name: "pricing",
    path: "/pricing",
    title: "Pricing — Basic, Pro, and Max plans | Misty",
  },
  {
    name: "changelog",
    path: "/changelog",
    title: "Changelog — Misty beta updates",
  },
  { name: "blog", path: "/blog", title: "Blog — Notes from Misty" },
  {
    name: "roadmap",
    path: "/roadmap",
    title: "Roadmap — What Misty is building",
  },
  { name: "legacy join", path: "/waitlist", title: "Join Misty — Misty" },
  { name: "sign in", path: "/signin", title: "Sign in — Misty" },
  {
    name: "register",
    path: "/register",
    title: "Create an account — Misty",
  },
  {
    name: "tokenless reset",
    path: "/reset",
    title: "Reset your password — Misty",
  },
  {
    name: "not found",
    path: "/route-that-does-not-exist",
    title: "Page not found — Misty",
  },
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
    test(`${route.name} renders accessibly in ${theme} mode`, async ({
      page,
    }) => {
      const pageErrors: Error[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));
      await prepareApiLessPage(page, theme);

      const response = await page.goto(route.path);

      expect(
        response?.ok(),
        `${route.path} should return a successful document`,
      ).toBe(true);
      await expect(page).toHaveTitle(route.title);
      await expect(page.locator("main")).toBeVisible();
      const footerTop = await page.locator("footer").evaluate((footer) => {
        const bounds = footer.getBoundingClientRect();
        return bounds.top + window.scrollY;
      });
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      expect(
        footerTop,
        `${route.path} should provide a full viewport before the footer`,
      ).toBeGreaterThanOrEqual(viewportHeight - 1);
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`(^|\\s)${theme}(\\s|$)`),
      );
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        /.{20,}/,
      );
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        route.title,
      );
      expect(
        pageErrors,
        `uncaught errors while rendering ${route.path}`,
      ).toEqual([]);

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

test("settings redirects signed-out visitors without an API server", async ({
  page,
}) => {
  await prepareApiLessPage(page, "dark");

  await page.goto("/settings");

  await expect(page).toHaveURL(/\/signin$/);
  await expect(page).toHaveTitle("Sign in — Misty");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("public pages share the footer's horizontal alignment rail", async ({
  page,
}) => {
  await prepareApiLessPage(page, "dark");

  for (const path of ["/", "/download", "/waitlist", "/signin"]) {
    await page.goto(path);

    const pageRail = page.locator("main .site-container").first();
    const footerRail = page.locator("footer .site-container");
    await expect(pageRail).toBeVisible();
    await expect(footerRail).toBeVisible();

    const [pageBox, footerBox] = await Promise.all([
      pageRail.boundingBox(),
      footerRail.boundingBox(),
    ]);

    expect(pageBox?.x).toBeCloseTo(footerBox?.x ?? Number.NaN, 1);
    expect(pageBox?.width).toBeCloseTo(footerBox?.width ?? Number.NaN, 1);
  }
});

test("the home hero headline and supporting copy share one text measure", async ({
  page,
}) => {
  await prepareApiLessPage(page, "dark");
  await page.goto("/");

  const [headlineBox, descriptionBox] = await Promise.all([
    page.locator("main h1").boundingBox(),
    page.locator("main h1 + p").boundingBox(),
  ]);

  expect(headlineBox?.x).toBeCloseTo(descriptionBox?.x ?? Number.NaN, 1);
  expect(headlineBox?.width).toBeCloseTo(
    descriptionBox?.width ?? Number.NaN,
    1,
  );
});
