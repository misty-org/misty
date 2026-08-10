import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function provideAuthenticatedSession(
  page: Page,
  user: {
    id: string;
    name: string;
    email: string;
    tier?: "basic" | "pro" | "max";
  },
) {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...user,
        created_at: "2026-07-01T00:00:00Z",
        tier: user.tier ?? "basic",
        status: "active",
        allows_use: true,
        expires_at: null,
        trial_started_at: null,
        license_device: "",
      }),
    });
  });
}

test("pricing publishes the finalized Basic, Pro, and Max plans", async ({
  page,
}) => {
  await page.goto("/pricing");

  const planSection = page.locator('section[aria-labelledby="plans-heading"]');
  await expect(planSection.locator("article")).toHaveCount(3);
  expect(
    await planSection.getByRole("heading", { level: 3 }).allTextContents(),
  ).toEqual(["Basic", "Pro", "Max"]);
  await expect(planSection.getByText("Free", { exact: true })).toBeVisible();
  await expect(planSection.getByText("$8", { exact: true })).toBeVisible();
  await expect(planSection.getByText("$19", { exact: true })).toBeVisible();
  await expect(
    planSection.getByText("Up to 10 Spaces", { exact: true }),
  ).toBeVisible();
  await expect(
    planSection.getByText("Approximately 6× Basic agent usage", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(planSection.getByText("2× Pro agent usage")).toBeVisible();
  await expect(
    planSection.getByText("250 GB storage", { exact: true }),
  ).toBeVisible();
  await expect(planSection.getByText("Most popular")).toBeVisible();
  await expect(
    planSection.getByRole("link", { name: "Get started free" }),
  ).toHaveAttribute("href", "/register");
  await expect(
    planSection.getByRole("button", { name: "Choose Pro" }),
  ).toBeVisible();
  await expect(
    planSection.getByRole("button", { name: "Choose Max" }),
  ).toBeVisible();

  const customerText = await page.locator("main").innerText();
  expect(customerText).not.toMatch(
    /\b(?:hosted ai|credits?|tokens?|micro-usd|provider costs?|per-seat)\b/i,
  );
});

test("an authenticated user can select annual Pro checkout", async ({
  page,
}) => {
  await provideAuthenticatedSession(page, {
    id: "user-123",
    name: "Maya Chen",
    email: "maya@misty.local",
  });

  let checkoutBody = "";
  await page.route("**/api/billing/checkout-session", async (route) => {
    checkoutBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "#subscription-checkout" }),
    });
  });

  await page.goto("/pricing");
  await page.getByText("Yearly", { exact: true }).click();
  await expect(page.getByText("$79", { exact: true })).toBeVisible();
  await expect(page.getByText("Save $17 per year")).toBeVisible();
  await expect(page.getByText("$189", { exact: true })).toBeVisible();
  await expect(page.getByText("Save $39 per year")).toBeVisible();
  await page.getByRole("button", { name: "Choose Pro" }).click();

  await expect
    .poll(() => checkoutBody)
    .toBe(JSON.stringify({ tier: "pro", interval: "year" }));
});

test("an authenticated user can select monthly Max checkout", async ({
  page,
}) => {
  await provideAuthenticatedSession(page, {
    id: "user-456",
    name: "Sam Rivera",
    email: "sam@misty.local",
  });

  let checkoutBody = "";
  await page.route("**/api/billing/checkout-session", async (route) => {
    checkoutBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "#subscription-checkout" }),
    });
  });

  await page.goto("/pricing");
  await page.getByRole("button", { name: "Choose Max" }).click();

  await expect
    .poll(() => checkoutBody)
    .toBe(JSON.stringify({ tier: "max", interval: "month" }));
});

test("an active subscriber cannot repurchase the current tier", async ({
  page,
}) => {
  let checkoutRequests = 0;

  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-subscribed",
        name: "Maya Chen",
        email: "maya@misty.local",
        created_at: "2026-07-01T00:00:00Z",
        tier: "pro",
        status: "active",
        allows_use: true,
        expires_at: null,
        trial_started_at: null,
        license_device: "",
        billing: {
          kind: "subscription",
          interval: "month",
          subscription_status: "active",
          current_period_end: "2026-08-19T12:00:00Z",
          cancel_at_period_end: false,
          customer_portal_available: true,
        },
      }),
    });
  });
  await page.route("**/api/billing/checkout-session", async (route) => {
    checkoutRequests += 1;
    await route.fulfill({
      status: 409,
      contentType: "text/plain",
      body: "active subscription already exists",
    });
  });

  await page.goto("/pricing?checkout=pro&interval=month");

  await expect(page).toHaveURL(/\/pricing$/);
  const proCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) });
  const maxCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Max", exact: true }) });
  await expect(
    proCard.getByRole("link", { name: "Manage subscription" }),
  ).toHaveAttribute("href", "/settings");
  await expect(
    maxCard.getByRole("link", { name: "Change to Max" }),
  ).toHaveAttribute("href", "/settings");
  await expect(
    maxCard.getByRole("link", { name: "Manage subscription" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Your Pro subscription is already active and renews automatically.",
    ),
  ).toBeVisible();
  expect(checkoutRequests).toBe(0);
});

test("an active Max subscription is mapped to the Max card", async ({
  page,
}) => {
  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-max-subscriber",
        name: "Maya Chen",
        email: "maya@misty.local",
        created_at: "2026-07-01T00:00:00Z",
        tier: "max",
        status: "active",
        allows_use: true,
        expires_at: null,
        trial_started_at: null,
        license_device: "",
        billing: {
          kind: "subscription",
          interval: "month",
          subscription_status: "active",
          current_period_end: "2026-08-29T05:22:40Z",
          cancel_at_period_end: false,
          customer_portal_available: true,
        },
      }),
    });
  });

  await page.goto("/pricing");

  const proCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Pro", exact: true }) });
  const maxCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Max", exact: true }) });
  await expect(
    maxCard.getByRole("link", { name: "Manage subscription" }),
  ).toHaveAttribute("href", "/settings");
  await expect(
    proCard.getByRole("link", { name: "Change to Pro" }),
  ).toHaveAttribute("href", "/settings");
  await expect(
    proCard.getByRole("link", { name: "Manage subscription" }),
  ).toHaveCount(0);
});

test("the effective paid tier is disabled while billing details catch up", async ({
  page,
}) => {
  let checkoutRequests = 0;

  await provideAuthenticatedSession(page, {
    id: "user-paid",
    name: "Maya Chen",
    email: "maya@misty.local",
    tier: "pro",
  });
  await page.route("**/api/billing/checkout-session", async (route) => {
    checkoutRequests += 1;
    await route.fulfill({
      status: 409,
      contentType: "text/plain",
      body: "active subscription already exists",
    });
  });

  await page.goto("/pricing?checkout=pro&interval=month");

  await expect(page).toHaveURL(/\/pricing$/);
  await expect(
    page.getByRole("button", { name: "Current plan" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Choose Max" }),
  ).toBeEnabled();
  await expect(
    page.getByText("You're already on the Pro plan."),
  ).toBeVisible();
  expect(checkoutRequests).toBe(0);
});

test("checkout success confirms the upgraded plan and renewal date", async ({
  page,
}) => {
  let accountRequest = 0;

  await page.route("**/api/me", async (route) => {
    accountRequest += 1;
    const upgraded = accountRequest > 1;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-upgraded",
        name: "Maya Chen",
        email: "maya@misty.local",
        created_at: "2026-07-01T00:00:00Z",
        tier: upgraded ? "pro" : "basic",
        status: "active",
        allows_use: true,
        expires_at: null,
        trial_started_at: null,
        license_device: "",
        billing: upgraded
          ? {
              kind: "subscription",
              interval: "month",
              subscription_status: "active",
              current_period_end: "2026-08-19T12:00:00Z",
              cancel_at_period_end: false,
              customer_portal_available: true,
            }
          : {
              kind: "free",
              interval: null,
              subscription_status: null,
              current_period_end: null,
              cancel_at_period_end: false,
              customer_portal_available: false,
            },
      }),
    });
  });

  await page.goto("/pricing?checkout=success");

  await expect(page).toHaveTitle("Plan upgraded — Misty");
  await expect(
    page.getByRole("heading", { name: "Your Pro plan is ready." }),
  ).toBeVisible();
  const details = page.locator("main dl");
  await expect(details.getByText("Plan", { exact: true })).toBeVisible();
  await expect(details.getByText("Pro", { exact: true })).toBeVisible();
  await expect(details.getByText("Status", { exact: true })).toBeVisible();
  await expect(details.getByText("Active", { exact: true })).toBeVisible();
  await expect(details.getByText("Renews", { exact: true })).toBeVisible();
  await expect(details.getByText("August 19, 2026")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to Misty" }),
  ).toHaveAttribute("href", "/");
  await expect(
    page.getByRole("link", { name: "View billing settings" }),
  ).toHaveAttribute("href", "/settings");
  await expect(
    page.locator('section[aria-labelledby="plans-heading"]'),
  ).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    accessibility.violations.flatMap(({ id, nodes }) =>
      nodes.map(({ target }) => `${id}: ${target.join(" > ")}`),
    ),
  ).toEqual([]);
});
