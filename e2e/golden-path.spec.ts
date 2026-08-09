import { expect, test } from "@playwright/test";

test("judge completes the persistent incident learning loop", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /reset demo/i }).click();
  await expect(page.getByText("War room is standing by")).toBeVisible();

  await page.getByRole("button", { name: /simulate incident/i }).click();
  await expect(page.getByText("INC-2077", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /recall past incidents/i }).click();
  await expect(page.getByText(/strong recurrence detected/i)).toBeVisible();

  await page.getByRole("button", { name: /^approve$/i }).click();
  await page.getByRole("button", { name: /mark completed/i }).click();
  await page.getByRole("button", { name: /resolve incident/i }).click();
  await page.getByRole("button", { name: /verify resolution/i }).click();
  await expect(page.locator(".loop-complete")).toContainText("Memory verified");

  await page.reload();
  await expect(page.locator(".loop-complete")).toContainText("Memory verified");
});
