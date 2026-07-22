import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import type {
  BillingUsageResponse,
  MeResponse,
} from "../src/pages/Dashboard/api";

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

const billingUsage: BillingUsageResponse = {
  plan: "pro",
  storage: {
    used_bytes: 12_000_000_000,
    reserved_bytes: 500_000_000,
    limit_bytes: 50_000_000_000,
    remaining_bytes: 38_000_000_000,
    over_quota: false,
  },
  hosted_ai: {
    used_ratio: 0.64,
    reset_at: "2026-08-01T00:00:00Z",
  },
  subscription: {
    status: "active",
    current_period_end: "2026-08-19T12:00:00Z",
    cancel_at_period_end: false,
    billing_interval: "month",
  },
};

const freeBillingUsage: BillingUsageResponse = {
  plan: "basic",
  storage: {
    used_bytes: 750_000_000,
    reserved_bytes: 0,
    limit_bytes: 2_000_000_000,
    remaining_bytes: 1_250_000_000,
    over_quota: false,
  },
  hosted_ai: {
    used_ratio: 0.35,
    reset_at: "2026-08-01T00:00:00Z",
  },
};

async function prepareAccount(
  page: Page,
  theme: Theme,
  me: MeResponse = baseMe,
  inspectRequest?: (route: Route) => void,
  usage: BillingUsageResponse = me.tier === "basic"
    ? freeBillingUsage
    : billingUsage,
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
        body: JSON.stringify({ ...usage, plan: me.tier }),
      });
      return;
    }

    if (url.pathname.endsWith("/me")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(me),
      });
      return;
    }

    if (url.pathname.endsWith("/billing/checkout-session")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "#subscription-checkout" }),
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

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
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
  await expect(
    page.getByRole("dialog", { name: "Account settings" }),
  ).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test(`settings opens as a focused account dialog in ${theme} mode`, async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await prepareAccount(page, theme);

    await page.goto("/pricing");
    await openAccountSettings(page);

    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`(^|\\s)${theme}(\\s|$)`),
    );
    const dialog = page.getByRole("dialog", { name: "Account settings" });
    await expect(
      dialog.getByRole("heading", { level: 1, name: "Account" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("navigation", { name: "Account settings sections" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Account", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      dialog.getByRole("button", { name: "Usage", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Billing", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Privacy", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText("Maya Chen", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Display name")).toHaveValue("Maya Chen");

    await dialog.getByRole("button", { name: "Usage", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { level: 1, name: "Usage" }),
    ).toBeVisible();
    await expect(dialog.getByText("12 GB of 50 GB used")).toBeVisible();
    await expect(dialog.getByText("38 GB")).toBeVisible();
    await expect(dialog.getByText("64% used")).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Hosted AI usage" }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        new Date(billingUsage.hosted_ai.reset_at).toLocaleDateString(),
        { exact: true },
      ),
    ).toBeVisible();

    await expect(dialog.getByRole("button", { name: "General" })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole("button", { name: "Diagnostics" }),
    ).toHaveCount(0);

    await dialog.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { level: 1, name: "Billing" }),
    ).toBeVisible();
    await expect(dialog.getByText("Pro · monthly")).toBeVisible();
    await expect(dialog.getByText("Active")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Manage billing" }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Privacy", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { level: 1, name: "Privacy" }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "Private Files and shared Space content are handled differently.",
      ),
    ).toBeVisible();
    expect(await dialog.innerText()).not.toMatch(/\b(?:max|mika|credits?)\b/i);

    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
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

    await dialog
      .getByRole("button", { name: "Close account settings" })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/pricing$/);
  });
}

test("account updates work while usage remains read-only", async ({ page }) => {
  const requests: Array<{ path: string; method: string; body: string | null }> =
    [];
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
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Saved.",
  );
  expect(requests).toContainEqual({
    path: "/api/me/profile",
    method: "PUT",
    body: JSON.stringify({ name: "Maya Rivera" }),
  });

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Usage", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByText("64% used")).toBeVisible();
  expect(requests.filter(({ path }) => path.includes("checkout"))).toEqual([]);
});

test("free accounts can select the monthly Pro trial", async ({ page }) => {
  const requests: Array<{ path: string; method: string; body: string | null }> =
    [];
  await prepareAccount(page, "dark", freeMe, (route) => {
    const request = route.request();
    requests.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      body: request.postData(),
    });
  });
  await page.goto("/pricing");
  await openAccountSettings(page);

  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(dialog.getByText(/50 GB of pooled owner storage/)).toBeVisible();
  await expect(
    dialog.getByText(/over 6× more Hosted AI capacity/),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Start Pro trial · $9/mo" }).click();
  await expect
    .poll(() =>
      requests.some(({ path }) => path.endsWith("/billing/checkout-session")),
    )
    .toBe(true);
  expect(requests).toContainEqual({
    path: "/api/billing/checkout-session",
    method: "POST",
    body: JSON.stringify({ tier: "pro", interval: "month" }),
  });
});

test("billing shows a one-time trial end date", async ({ page }) => {
  const trialMe: MeResponse = {
    ...baseMe,
    status: "trialing",
    billing: {
      ...baseMe.billing!,
      kind: "trial",
    },
  };
  const trialUsage: BillingUsageResponse = {
    ...billingUsage,
    subscription: undefined,
    trial: {
      status: "trialing",
      ends_at: "2026-08-05T12:00:00Z",
    },
  };
  await prepareAccount(page, "light", trialMe, undefined, trialUsage);
  await page.goto("/pricing");
  await openAccountSettings(page);

  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(dialog.getByText("Trialing")).toBeVisible();
  await expect(dialog.getByText(/8\/5\/2026/)).toBeVisible();
  await expect(dialog.getByText("Pro trial")).toBeVisible();
});

test("billing shows a scheduled cancellation without implying data loss", async ({
  page,
}) => {
  const cancellationUsage: BillingUsageResponse = {
    ...billingUsage,
    subscription: {
      ...billingUsage.subscription!,
      cancel_at_period_end: true,
    },
  };
  await prepareAccount(page, "dark", baseMe, undefined, cancellationUsage);
  await page.goto("/pricing");
  await openAccountSettings(page);

  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Billing", exact: true }).click();
  await expect(dialog.getByText("Cancellation scheduled")).toBeVisible();
  await expect(dialog.getByText(/8\/19\/2026/)).toBeVisible();
});

test("storage over quota pauses uploads without threatening existing data", async ({
  page,
}) => {
  const overQuotaUsage: BillingUsageResponse = {
    ...freeBillingUsage,
    storage: {
      ...freeBillingUsage.storage,
      used_bytes: 2_250_000_000,
      remaining_bytes: 0,
      over_quota: true,
      over_quota_since: "2026-07-20T12:00:00Z",
      cleanup_notice_until: "2026-08-20T12:00:00Z",
    },
  };
  await prepareAccount(page, "light", freeMe, undefined, overQuotaUsage);
  await page.goto("/pricing");
  await openAccountSettings(page);

  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(
    dialog.getByText(/new hosted uploads are paused/i),
  ).toBeVisible();
  await expect(dialog.getByText(/existing data remains intact/i)).toBeVisible();
  await expect(
    dialog.getByText(/nothing is automatically deleted/i),
  ).toBeVisible();
});

test("an authenticated legacy settings URL opens the dialog over home", async ({
  page,
}) => {
  await prepareAccount(page, "dark");

  await page.goto("/settings");

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("dialog", { name: "Account settings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Account" }),
  ).toBeVisible();
});
