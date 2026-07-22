import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/download");
});

test("download page presents the current desktop release", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Download" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Releases" })).toBeVisible();
  await expect(page.getByText("v0.1.0 (latest)")).toBeVisible();

  for (const platform of ["Windows", "macOS"]) {
    const card = page.getByRole("article").filter({ hasText: platform });
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name: new RegExp(`Download Misty .* for ${platform}`) })).toBeVisible();
  }
});

test("release details can be collapsed and restored", async ({ page }) => {
  const releaseToggle = page.getByRole("button", { name: "v0.1.0 (latest)" });
  await releaseToggle.click();
  await expect(page.getByRole("article")).toHaveCount(0);

  await releaseToggle.click();
  await expect(page.getByRole("article")).toHaveCount(2);
});
