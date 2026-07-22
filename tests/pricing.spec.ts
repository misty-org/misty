import { expect, test } from "@playwright/test";

test("pricing publishes only Free and Pro without retired terminology", async ({
  page,
}) => {
  await page.goto("/pricing");

  const planSection = page.locator('section[aria-labelledby="plans-heading"]');
  await expect(planSection.locator("article")).toHaveCount(2);
  expect(
    await planSection.getByRole("heading", { level: 3 }).allTextContents(),
  ).toEqual(["Free", "Pro"]);
  await expect(planSection.getByText("$9", { exact: true })).toBeVisible();
  await expect(
    planSection.getByText("over 6× more Hosted AI capacity", { exact: true }),
  ).toBeVisible();

  const customerText = await page.locator("main").innerText();
  expect(customerText).not.toMatch(/\b(?:max|mika|credits?)\b/i);
});

test("an authenticated user can select annual Pro checkout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "misty_user",
      JSON.stringify({
        id: "user-123",
        name: "Maya Chen",
        email: "maya@misty.local",
      }),
    );
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
  await expect(page.getByText("$89", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start 14-day trial" }).click();

  await expect
    .poll(() => checkoutBody)
    .toBe(JSON.stringify({ tier: "pro", interval: "year" }));
});
