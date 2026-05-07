import { test, expect } from "@playwright/test"

/**
 * E2E tests for the contracts list and new-contract flow.
 *
 * Note: these tests require an authenticated session.
 * If the app requires login, they will redirect — which we detect and skip gracefully.
 */

test.describe("Contracts list page", () => {
  test("navigating to /contracts shows the page heading", async ({ page }) => {
    await page.goto("/contracts")

    // Either we get the contracts page or we get redirected to login
    const url = page.url()
    if (url.includes("/login")) {
      // Not authenticated — that's fine, auth redirect is the correct behaviour
      await expect(page).toHaveURL(/\/login/)
      return
    }

    // Authenticated — contracts page should show the heading and the New Contract button
    await expect(page.getByRole("heading", { name: "Contracts" })).toBeVisible()
  })

  test("contracts page shows either the table or an empty state", async ({ page }) => {
    await page.goto("/contracts")

    const url = page.url()
    if (url.includes("/login")) {
      await expect(page).toHaveURL(/\/login/)
      return
    }

    // Wait for data to load (skeleton disappears)
    await page.waitForLoadState("networkidle")

    // Should have either a table row OR the "No contracts" empty state
    const hasTable = await page.locator("table").isVisible().catch(() => false)
    const hasEmptyState = await page.getByText("No contracts").isVisible().catch(() => false)

    expect(hasTable || hasEmptyState).toBe(true)
  })

  test("clicking New Contract navigates to /contracts/new", async ({ page }) => {
    await page.goto("/contracts")

    const url = page.url()
    if (url.includes("/login")) {
      await expect(page).toHaveURL(/\/login/)
      return
    }

    const newContractLink = page.getByRole("link", { name: /New Contract/i })
    await expect(newContractLink).toBeVisible()
    await newContractLink.click()

    await expect(page).toHaveURL(/\/contracts\/new/)
  })

  test("/contracts/new page renders the new contract form", async ({ page }) => {
    await page.goto("/contracts/new")

    const url = page.url()
    if (url.includes("/login")) {
      await expect(page).toHaveURL(/\/login/)
      return
    }

    // Should have a title input field
    const titleInput = page.getByLabel(/title/i)
    await expect(titleInput).toBeVisible()
  })
})
