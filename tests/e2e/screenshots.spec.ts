// Captures README screenshots. Run with: npm run screenshots
import { expect, test } from "@playwright/test";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture docs/screenshots");

const shot = (name: string) => ({ path: `docs/screenshots/${name}.png`, fullPage: true });

test("capture", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("transport")).toHaveText("updates: SSE");
  await page.screenshot(shot("overview"));

  await page.goto("/approvals");
  await expect(page.getByRole("article").first()).toBeVisible();
  await page.getByLabel("Reviewer name").fill("vinay");
  await page.screenshot(shot("approvals"));

  const res = await request.post("/api/runtime/runs", { data: { user_id: "alice", task: "Deploy the docs site. Remember: alice owns docs" } });
  const { run_id } = await res.json();
  await page.goto(`/runs/${run_id}`);
  await expect(page.getByText("waiting for a human decision")).toBeVisible({ timeout: 10_000 });
  await page.screenshot(shot("run-timeline"));

  await page.goto("/memories?user=alice");
  await expect(page.getByText("I prefer weekly summaries")).toBeVisible();
  await page.screenshot(shot("memory"));

  await page.goto("/permissions");
  await expect(page.getByTestId("audit")).toContainText("intact");
  await page.screenshot(shot("permissions"));
});
