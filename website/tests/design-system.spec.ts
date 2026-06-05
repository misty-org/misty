import { expect, test } from "@playwright/test";

const zincCharts = [
  "oklch(0.871 0.006 286.286)",
  "oklch(0.552 0.016 285.938)",
  "oklch(0.442 0.017 285.786)",
  "oklch(0.37 0.013 285.805)",
  "oklch(0.274 0.006 286.033)",
];

test("the canonical shadcn preset fonts and tokens are active", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("misty-ui-theme", "light");
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    }),
  );

  await page.goto("/");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const preset = await page.evaluate(() => {
    const rootStyles = getComputedStyle(document.documentElement);
    const heading = document.querySelector("h1");

    return {
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: heading ? getComputedStyle(heading).fontFamily : "",
      fontsLoaded: {
        inter: document.fonts.check('16px "Inter Variable"'),
      },
      radius: rootStyles.getPropertyValue("--radius").trim(),
      overscrollBehaviorY: rootStyles.overscrollBehaviorY,
      charts: Array.from({ length: 5 }, (_, index) =>
        rootStyles.getPropertyValue(`--chart-${index + 1}`).trim(),
      ),
    };
  });

  expect(preset.bodyFont).toContain("Inter Variable");
  expect(preset.headingFont).toContain("Inter Variable");
  expect(preset.fontsLoaded).toEqual({ inter: true });
  expect(preset.radius).toBe("0.625rem");
  expect(preset.overscrollBehaviorY).toBe("none");
  expect(preset.charts).toEqual(zincCharts);
});
