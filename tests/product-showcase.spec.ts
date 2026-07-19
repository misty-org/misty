import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
});

test("the product showcase uses accessible user-controlled tabs", async ({ page }) => {
  const showcase = page.locator("[data-showcase-root]");
  await showcase.scrollIntoViewIfNeeded();

  const filesTab = showcase.getByRole("tab", { name: "Files" });
  const spaceTab = showcase.getByRole("tab", { name: "Space" });
  const intelligenceTab = showcase.getByRole("tab", { name: "Intelligence" });

  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  await expect(showcase.locator('[data-showcase-panel="files"]')).toBeVisible();
  await expect(showcase.getByRole("img", { name: "Files demo placeholder" })).toBeVisible();

  await spaceTab.click();
  await expect(spaceTab).toHaveAttribute("aria-selected", "true");
  await expect(showcase.locator('[data-showcase-panel="space"]')).toBeVisible();
  await expect(showcase.getByRole("img", { name: "Space demo placeholder" })).toBeVisible();

  await intelligenceTab.click();
  await expect(intelligenceTab).toHaveAttribute("aria-selected", "true");
  await expect(showcase.locator('[data-showcase-panel="intelligence"]')).toBeVisible();
  await expect(
    showcase.getByRole("img", { name: "Intelligence demo placeholder" }),
  ).toBeVisible();
});

test("the product showcase supports keyboard navigation", async ({ page }) => {
  const showcase = page.locator("[data-showcase-root]");
  await showcase.scrollIntoViewIfNeeded();

  const filesTab = showcase.getByRole("tab", { name: "Files" });
  const spaceTab = showcase.getByRole("tab", { name: "Space" });
  const intelligenceTab = showcase.getByRole("tab", { name: "Intelligence" });

  await filesTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(spaceTab).toBeFocused();
  await expect(spaceTab).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("End");
  await expect(intelligenceTab).toBeFocused();
  await expect(intelligenceTab).toHaveAttribute("aria-selected", "true");
});

test("the simplified showcase is responsive and honors reduced motion", async ({ page }) => {
  const showcase = page.locator("[data-showcase-root]");
  await showcase.scrollIntoViewIfNeeded();

  await expect(showcase).toHaveAttribute("data-motion", "reduced");

  const viewport = page.viewportSize();
  const showcaseBox = await showcase.boundingBox();
  expect(viewport).not.toBeNull();
  expect(showcaseBox).not.toBeNull();
  expect(showcaseBox!.height).toBeLessThan(viewport!.height * 2);

  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-showcase-root]");
    return {
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      opacity: root ? getComputedStyle(root).opacity : "",
      transform: root ? getComputedStyle(root).transform : "",
    };
  });

  expect(layout.hasHorizontalOverflow).toBe(false);
  expect(layout.opacity).toBe("1");
  expect(layout.transform).toBe("none");
});

test("the homepage uses a sticky push-up stack after the hero carousel", async ({ page }, testInfo) => {
  const anchor = page.locator("[data-scroll-stack-anchor]");
  const spacer = page.locator("[data-scroll-stack-spacer]");
  const stage = page.locator("[data-scroll-stage]");
  const panels = page.locator("[data-scroll-stack-panel]");

  await expect(anchor).toHaveCSS("position", "sticky");
  const navigationBox = await page.locator("nav.fixed").boundingBox();
  const anchorTop = await anchor.evaluate((element) => parseFloat(getComputedStyle(element).top));
  expect(navigationBox).not.toBeNull();
  expect(Math.abs(anchorTop - navigationBox!.height)).toBeLessThanOrEqual(1.1);
  const spacerBox = await spacer.boundingBox();
  expect(spacerBox).not.toBeNull();
  expect(spacerBox!.height).toBeCloseTo(page.viewportSize()!.height * 0.3, 0);
  const stageRadius = await stage.evaluate((element) =>
    parseFloat(getComputedStyle(element).borderTopLeftRadius),
  );
  expect(stageRadius).toBeGreaterThanOrEqual(32);
  await expect(panels).toHaveCount(4);

  if (testInfo.project.name === "desktop-chromium") {
    for (const panel of await panels.all()) {
      await expect(panel).toHaveCSS("position", "sticky");
      const panelTop = await panel.evaluate((element) => parseFloat(getComputedStyle(element).top));
      expect(Math.abs(panelTop - navigationBox!.height)).toBeLessThanOrEqual(1.1);
    }
  } else {
    for (const panel of await panels.all()) {
      await expect(panel).toHaveCSS("position", "relative");
    }
  }
});
