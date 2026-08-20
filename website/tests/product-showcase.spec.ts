import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
});

test("the homepage tells the complete collaboration story", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The operating system for human and agent work.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Launch a collaborative, agentic workspace for any group in seconds.",
      { exact: true },
    ),
  ).toBeVisible();

  // The hero product shot is a live DOM window, not a captured screenshot.
  // Filter to visible: each pinned track keeps a hidden twin of its window
  // for the stacked fallback, and under reduced motion the pinned copy is the
  // one that's display:none.
  await expect(
    page.locator(".app-chrome").filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.locator('img[src*="space-library-crop"]')).toHaveCount(0);
  await expect(
    page.getByText("Message Launch plan").filter({ visible: true }).first(),
  ).toBeVisible();

  // The status bar is where the privacy claim gets made, as ordinary UI.
  // Assert the leading half of each bar: the trailing half is dropped on a
  // narrow window rather than wrapping the bar onto two lines.
  await expect(
    page.getByText("Launch plan · 5 members").filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText("2,418 files on this Mac · private to you")
      .filter({ visible: true })
      .first(),
  ).toBeVisible();

  // Each resource preview links out to its own section.
  const viewAll = page.getByRole("link", { name: "View all" });
  await expect(viewAll).toHaveCount(3);
  await expect(viewAll.nth(0)).toHaveAttribute("href", "/blog");
  await expect(viewAll.nth(1)).toHaveAttribute("href", "/changelog");
  await expect(viewAll.nth(2)).toHaveAttribute("href", "/roadmap");
});

test("every showcase surface is rendered, not promised", async ({ page }) => {
  // The showcase used to render dashed "Screenshot placeholder" boxes, and
  // several pages shipped Lorem ipsum. Both are regressions worth catching.
  await expect(page.getByText("Screenshot placeholder")).toHaveCount(0);
  await expect(page.getByText(/lorem ipsum/i)).toHaveCount(0);

  const showcase = page.getByRole("region", { name: "Misty product showcase" });
  await expect(showcase.locator(".app-chrome")).toHaveCount(4);

  for (const title of [
    "One Space per group",
    "Your files stay yours",
    "Agents that read the Space",
    "A Library the group builds",
  ]) {
    await expect(showcase.getByRole("heading", { name: title })).toBeVisible();
  }
});

test("the product templates are available without motion-dependent UI", async ({
  page,
}) => {
  await expect(
    page.getByText("Launch plan · 5 members").filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(page.locator("video[autoplay]")).toHaveCount(0);
  await expect(
    page.locator("[data-scroll-stack-anchor], [data-scroll-stack-panel]"),
  ).toHaveCount(0);

  // Under reduced motion every scroll-pinned track — the hero's scale-up and
  // the walkthrough — is replaced by its stacked fallback, so nothing is
  // reachable only by animating.
  const tracks = page.locator(".pin-track");
  await expect(tracks).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) {
    await expect(tracks.nth(i)).toBeHidden();
  }
  const howItWorks = page.getByRole("region", { name: "How Misty works" });
  for (const beat of [
    "Create a Space",
    "Your files stay private",
    "Pool what the group needs",
    "Put Agents on it",
  ]) {
    await expect(howItWorks.getByRole("heading", { name: beat })).toBeVisible();
  }
});

test("the homepage is complete, responsive, and free of horizontal overflow", async ({
  page,
}) => {
  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const layout = await page.evaluate(() => ({
    hasHorizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth,
    documentHeight: document.documentElement.scrollHeight,
    visibleText: document.body.innerText.length,
  }));

  expect(layout.hasHorizontalOverflow).toBe(false);
  expect(layout.documentHeight).toBeGreaterThan(
    page.viewportSize()!.height * 3,
  );
  expect(layout.visibleText).toBeGreaterThan(600);
});

test("the hero call to action moves visitors to sign up", async ({ page }) => {
  const hero = page.locator("section").first();
  const getStartedLink = hero.getByRole("link", { name: "Get started" });
  await expect(getStartedLink).toHaveAttribute("href", "/register");
  await getStartedLink.click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Create an account" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("the footer keeps product resources and community links focused", async ({
  page,
}) => {
  const footer = page.getByRole("contentinfo");
  await footer.scrollIntoViewIfNeeded();

  await expect(footer.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(
    footer.getByRole("heading", { name: "Resources" }),
  ).toBeVisible();
  await expect(
    footer.getByRole("heading", { name: "Subscribe" }),
  ).toHaveCount(0);
  await expect(footer.getByRole("link", { name: "GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/misty-org",
  );
  await expect(
    footer.getByRole("link", { name: "X.com link placeholder" }),
  ).toBeVisible();
  await expect(
    footer.getByRole("link", { name: "Discord link placeholder" }),
  ).toBeVisible();
  await expect(footer.getByText(/careers?|enterprise/i)).toHaveCount(0);
});
