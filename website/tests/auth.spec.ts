import { expect, test, type Page } from "@playwright/test";

const account = {
  id: "user-auth",
  name: "Maya Chen",
  email: "maya@misty.local",
  created_at: "2026-07-01T00:00:00Z",
  tier: "pro",
  status: "active",
  allows_use: true,
  expires_at: null,
  trial_started_at: null,
  license_device: "",
};

async function provideAuthApi(page: Page, initiallyAuthenticated: boolean) {
  let authenticated = initiallyAuthenticated;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) {
      authenticated = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user_id: account.id,
          name: account.name,
          email: account.email,
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/logout")) {
      authenticated = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      });
      return;
    }
    if (url.pathname.endsWith("/me")) {
      await route.fulfill({
        status: authenticated ? 200 : 401,
        contentType: "application/json",
        body: JSON.stringify(
          authenticated ? account : { error: "Unauthorized" },
        ),
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

async function expectSignedIn(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.getByRole("button", { name: "Close navigation menu" }).click();
    return;
  }
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toBeVisible();
}

async function signOut(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    return;
  }
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

test("signed-out navigation waits for the session check", async ({ page }) => {
  let releaseSessionCheck: (() => void) | undefined;
  let markSessionRequested: (() => void) | undefined;
  const sessionRequested = new Promise<void>((resolve) => {
    markSessionRequested = resolve;
  });
  const sessionCheckGate = new Promise<void>((resolve) => {
    releaseSessionCheck = resolve;
  });

  await page.route("**/api/me", async (route) => {
    markSessionRequested?.();
    await sessionCheckGate;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    });
  });

  await page.goto("/");
  await sessionRequested;
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await expect(
    navigation.getByRole("link", { name: "Misty home" }),
  ).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Join now" })).toHaveCount(0);

  releaseSessionCheck?.();

  await expect(
    navigation.getByRole("link", { name: "Misty home" }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }
  await expect(navigation.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Join now" })).toBeVisible();
});

test("signed-out visitors can reach account creation from navigation and sign in", async ({
  page,
}) => {
  await provideAuthApi(page, false);
  await page.goto("/");

  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }

  const joinLink = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Join now" });
  await expect(joinLink).toHaveAttribute("href", "/register");

  await page.goto("/signin");
  await expect(page.getByText("Sign in to pick up where you left off in Misty.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Don’t have an account? Create one" }),
  ).toHaveAttribute("href", "/register");
});

test("client-side route focus announces sign in without drawing a heading outline", async ({
  page,
}) => {
  await provideAuthApi(page, false);
  await page.goto("/pricing");

  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Sign in" })
    .click();

  const heading = page.getByRole("heading", { name: "Welcome back" });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveCSS("outline-style", "none");
});

test("signing in reloads the document at home", async ({ page }) => {
  await provideAuthApi(page, false);
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });

  await page.goto("/signin");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => documentRequests).toBe(2);
  await expectSignedIn(page);
});

test("signing out clears the session and reloads the document at home", async ({
  page,
}) => {
  await provideAuthApi(page, true);
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });

  await page.goto("/pricing");
  await expectSignedIn(page);
  await signOut(page);

  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => documentRequests).toBe(2);
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
