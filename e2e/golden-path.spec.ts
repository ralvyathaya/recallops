import { expect, test } from "@playwright/test";

test("judge completes the persistent incident learning loop", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /reset demo/i }).click();
  await expect(page.getByText("War room is standing by")).toBeVisible();
  await expect(page.getByRole("img", { name: /recallops memory loop/i })).toBeVisible();
  await expect(page.getByText(/live incident sandbox/i)).toBeVisible();
  await expect(page.getByText(/synthetic incident data · real aws \+ cockroachdb execution/i)).toBeVisible();
  await expect(page.getByText(/approved fix still incomplete/i)).toBeVisible();
  const proofFlow = page.getByRole("list", { name: /how recallops works/i });
  await expect(proofFlow).toContainText("Detect");
  await expect(proofFlow).toContainText("CockroachDB memory");
  await expect(proofFlow).toContainText("Human decision");
  await expect(proofFlow).toContainText("Verified postmortem");

  await page.getByRole("button", { name: /simulate incident/i }).click();
  await expect(page.getByText("INC-2077", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /recall past incidents/i }).click();
  await expect(page.getByText(/strong recurrence detected/i)).toBeVisible();
  await expect(page.getByText(/recalled from unfinished action in inc-1042/i)).toBeVisible();
  await expect(page.getByText(/mcp found approved incomplete action/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^approve$/i })).toHaveCount(1);

  await page.getByRole("button", { name: /^approve$/i }).click();
  await page.getByRole("button", { name: /mark completed/i }).click();
  await page.getByRole("button", { name: /resolve incident/i }).click();
  await expect(page.locator(".learned-memory")).toContainText("proposed");
  await page.getByRole("button", { name: /verify resolution/i }).click();
  await expect(page.getByRole("status")).toContainText("Memory verified");
  await expect(page.locator(".learned-memory")).toContainText("verified");

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Memory verified");
  await expect(page.locator(".learned-memory")).toContainText("verified");
});

test("active proof surfaces the action and trace at 1440 by 900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /reset demo/i }).click();
  await page.getByRole("button", { name: /simulate incident/i }).click();
  await page.getByRole("button", { name: /recall past incidents/i }).click();
  await expect(page.getByText(/recalled from unfinished action in inc-1042/i)).toBeVisible();

  const actionHeading = await page.getByRole("heading", { name: /approval-gated actions/i }).boundingBox();
  const traceHeading = await page.getByText("Agent tool trace", { exact: true }).boundingBox();
  expect(actionHeading?.y).toBeLessThan(900);
  expect(traceHeading?.y).toBeLessThan(900);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 1024, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`dashboard has no horizontal overflow on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.getByText("War room is standing by")).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}
