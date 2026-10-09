import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("overview shows mock mode, seeded runs and live SSE", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("runtime: mock")).toBeVisible();
  await expect(page.getByTestId("transport")).toHaveText("updates: SSE");
  await expect(page.getByTestId("health")).toHaveText("ok (mock)");
  await expect(page.getByRole("table", { name: "runs" }).getByRole("row")).not.toHaveCount(1);
});

test("a run started elsewhere appears live, walks the graph, and is approved from the inbox", async ({ page, request }) => {
  await page.goto("/runs");
  await expect(page.getByTestId("transport")).toHaveText("updates: SSE");
  const res = await request.post("/api/runtime/runs", { data: { user_id: "e2e", task: "Pay supplier invoice 88. Remember: e2e pays net-30" } });
  expect(res.status()).toBe(201);
  const { run_id } = await res.json();

  const row = page.locator(`tr[data-run-id="${run_id}"]`);
  await expect(row).toBeVisible(); // pushed over SSE, no reload
  await expect(row.getByText("needs approval")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: /Approvals/ }).click();
  await page.getByLabel("Reviewer name").fill("e2e-reviewer");
  const card = page.getByRole("article", { name: `approval for run ${run_id}` });
  await expect(card.getByText("pay", { exact: true })).toBeVisible();
  await card.getByLabel("Comment").fill("ok to pay");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toHaveCount(0);

  await page.goto(`/runs/${run_id}`);
  await expect(page.getByText("succeeded").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("approved by e2e-reviewer: ok to pay")).toBeVisible();
  await expect(page.getByText(/simulated pay executed/)).toBeVisible();

  await page.getByRole("link", { name: "e2e" }).click();
  await expect(page.getByRole("table", { name: "memories" })).toContainText("e2e pays net-30");
});

test("tool permissions: grant, save, simulate", async ({ page }) => {
  await page.goto("/permissions");
  const box = page.getByLabel("viewer can use hubspot_create_contact");
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByLabel("viewer can use hubspot_create_contact")).toBeChecked();

  const sim = page.getByRole("region", { name: "policy simulator" });
  await sim.getByLabel("tool").selectOption("slack_post_message");
  await sim.getByLabel("arguments").fill('{"channel": "#random"}');
  await sim.getByLabel("principal has admin").check();
  await sim.getByRole("button", { name: "Check" }).click();
  await expect(page.getByTestId("decision")).toHaveText("deny: arg_not_allowed:channel");
  await expect(page.getByTestId("audit")).toContainText("intact");
});
