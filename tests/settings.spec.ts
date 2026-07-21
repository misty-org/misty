import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import type { MeResponse } from "../src/pages/Dashboard/api";

type Theme = "light" | "dark";

const baseMe: MeResponse = {
  id: "user-123",
  name: "Maya Chen",
  email: "maya@misty.local",
  created_at: "2025-04-12T12:00:00Z",
  tier: "pro",
  status: "active",
  allows_use: true,
  expires_at: null,
  trial_started_at: null,
  license_device: "Studio Mac",
  billing: {
    kind: "subscription",
    interval: "month",
    subscription_status: "active",
    current_period_end: "2026-08-19T12:00:00Z",
    cancel_at_period_end: false,
    customer_portal_available: true,
  },
};

const freeMe: MeResponse = {
  ...baseMe,
  tier: "basic",
  billing: {
    kind: "free",
    interval: null,
    subscription_status: null,
    current_period_end: null,
    cancel_at_period_end: false,
    customer_portal_available: false,
  },
};

const billingUsage = {
  plan: "pro",
  monthly_allowance: 2_000,
  monthly_remaining: 720,
  purchased_remaining: 125,
  available_credits: 845,
  reserved_credits: 0,
  next_reset_at: "2026-08-01T00:00:00Z",
  usage_by_meter: [{ meter: "managed_ai", credits: 1_280 }],
};

async function prepareAccount(
  page: Page,
  theme: Theme,
  me: MeResponse = baseMe,
  inspectRequest?: (route: Route) => void,
) {
  await page.addInitScript(
    ({ account, initialTheme }) => {
      window.localStorage.clear();
      window.localStorage.setItem("misty_user", JSON.stringify(account));
      window.localStorage.setItem("misty-ui-theme", initialTheme);
    },
    {
      account: { id: me.id, name: me.name, email: me.email },
      initialTheme: theme,
    },
  );

  await page.route("**/api/**", async (route) => {
    inspectRequest?.(route);
    const url = new URL(route.request().url());

    if (url.pathname.endsWith("/billing/usage")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...billingUsage, plan: me.tier }),
      });
      return;
    }

    if (url.pathname.endsWith("/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) });
      return;
    }

    if (url.pathname.endsWith("/billing/credit-checkout-session")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "#credit-checkout" }),
      });
      return;
    }

    if (url.pathname.endsWith("/billing/portal-session")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "#billing-portal" }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function openAccountSettings(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
  } else {
    await page.getByRole("button", { name: "Open account menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
  }
  await expect(page.getByRole("dialog", { name: "Account settings" })).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test(`settings opens as a focused account dialog in ${theme} mode`, async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await prepareAccount(page, theme);

    await page.goto("/pricing");
    await openAccountSettings(page);

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
    const dialog = page.getByRole("dialog", { name: "Account settings" });
    await expect(dialog.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await expect(dialog.getByRole("navigation", { name: "Account settings sections" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Account", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(dialog.getByRole("button", { name: "Credits", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Billing", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Privacy", exact: true })).toBeVisible();
    await expect(dialog.getByText("Maya Chen", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Display name")).toHaveValue("Maya Chen");

    await dialog.getByRole("button", { name: "Credits", exact: true }).click();
    await expect(dialog.getByRole("heading", { level: 1, name: "Credits" })).toBeVisible();
    await expect(dialog.getByText("845 credits")).toBeVisible();
    await expect(dialog.getByText("720 of 2,000 remaining")).toBeVisible();
    await expect(
      dialog.getByText("Credit checkout is not open during the invite-only beta."),
    ).toBeVisible();

    await expect(dialog.getByRole("button", { name: "General" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Diagnostics" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(dialog.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
    await expect(dialog.getByText("Monthly subscription")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Manage billing" })).toBeVisible();

    await dialog.getByRole("button", { name: "Privacy", exact: true }).click();
    await expect(dialog.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await expect(
      dialog.getByText("Private Files and shared Space content are handled differently."),
    ).toBeVisible();

    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    if ((page.viewportSize()?.width ?? 1440) < 768) {
      expect(geometry).toEqual({ width: 366, height: 820, overflow: 0 });
    } else {
      expect(geometry).toEqual({ width: 980, height: 760, overflow: 0 });
    }
    expect(pageErrors).toEqual([]);

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      accessibility.violations.flatMap(({ id, nodes }) =>
        nodes.map(({ target }) => `${id}: ${target.join(" > ")}`),
      ),
    ).toEqual([]);

    await dialog.getByRole("button", { name: "Close account settings" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/pricing$/);
  });
}

test("account updates work while planned credit checkout remains closed", async ({ page }) => {
  const requests: Array<{ path: string; method: string; body: string | null }> = [];
  await prepareAccount(page, "dark", baseMe, (route) => {
    const request = route.request();
    requests.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      body: request.postData(),
    });
  });
  await page.goto("/pricing");
  await openAccountSettings(page);

  await page.getByRole("dialog").getByLabel("Display name").fill("Maya Rivera");
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("Saved.");
  expect(requests).toContainEqual({
    path: "/api/me/profile",
    method: "PUT",
    body: JSON.stringify({ name: "Maya Rivera" }),
  });

  await page.getByRole("dialog").getByRole("button", { name: "Credits", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Credit checkout is not open during the invite-only beta."),
  ).toBeVisible();
  expect(requests.some(({ path }) => path === "/api/billing/credit-checkout-session")).toBe(false);
});

test("free accounts see beta pricing without a subscription checkout action", async ({ page }) => {
  const requests: string[] = [];
  await prepareAccount(page, "dark", freeMe, (route) => {
    requests.push(new URL(route.request().url()).pathname);
  });
  await page.goto("/pricing");
  await openAccountSettings(page);

  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(dialog.getByText("Paid checkout is not open during the invite-only beta.")).toBeVisible();
  await expect(dialog.getByText(/Pro at \$8\.99 monthly or \$89 yearly/)).toBeVisible();
  await expect(dialog.getByText(/Max at \$19\.99 monthly or \$199 yearly/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Join the beta" })).toHaveAttribute(
    "href",
    "/waitlist",
  );
  expect(requests.some((path) => path.endsWith("/billing/checkout-session"))).toBe(false);
});

test("an authenticated legacy settings URL opens the dialog over home", async ({ page }) => {
  await prepareAccount(page, "dark");

  await page.goto("/settings");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("dialog", { name: "Account settings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
});
