import { test, expect } from "@playwright/test";

test("call log and appointments", async ({ page }) => {
  await page.goto("/calls");
  await expect(page.getByRole("heading", { name: "Calls" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Maya Chen" })).toBeVisible();
  await expect(page.locator(".pill.transferred")).toHaveText("Transferred");
  await expect(page.getByText("Fictional clinic · demo data")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/calls-list.png", fullPage: true });

  await page.getByRole("link", { name: "Maya Chen" }).click();
  await expect(page.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
  await expect(page.locator("code", { hasText: "book_appointment" })).toBeVisible();
  await expect(page.locator(".transcript")).toContainText("312-555-0121");
  await expect(page.locator(".summary")).toContainText("Booked a cleaning");
  await page.screenshot({ path: "docs/screenshots/call-detail.png", fullPage: true });

  await page.goto("/appointments");
  await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
  await expect(page.getByText("Maya Chen")).toBeVisible();
  await expect(page.getByText("Andre Brooks")).toBeVisible();
  await expect(page.getByText("Priya Shah")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/appointments.png", fullPage: true });
});

test("search and missing call", async ({ page }) => {
  await page.goto("/calls?q=hardware");
  await expect(page.getByText("Samir Patel")).toBeVisible();
  await expect(page.getByText("Maya Chen")).toHaveCount(0);
  await page.goto("/calls/missing");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("landing page offers the browser call", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Talk to the front desk." })).toBeVisible();
  const talk = page.getByRole("button", { name: "Talk to the receptionist" });
  await expect(talk).toBeVisible();
  await expect(talk).not.toHaveAttribute("data-public-key", /.+/);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Appointments" })).toHaveAttribute("href", "/appointments");
});

test("landing page shows the limit message when the server refuses a call", async ({ page }) => {
  await page.route("**/api/call-token", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: "call_limit_reached",
        scope: "visitor",
        message: "You have used the 3 demo calls allowed per visitor in 24 hours. Please try again in about 5 hours.",
      }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to the receptionist" }).click();
  await expect(page.locator("#status")).toHaveText(/used the 3 demo calls/);
  await expect(page.locator("#console")).toHaveAttribute("data-state", "limited");
});
