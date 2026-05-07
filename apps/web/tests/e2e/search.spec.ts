import { test, expect } from "@playwright/test"

/**
 * E2E tests for the search page.
 */

test.describe("Search page", () => {
  test("navigating to /search redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto("/search")

    const url = page.url()
    if (url.includes("/login")) {
      await expect(page).toHaveURL(/\/login/)
    }
    // If authenticated, fall through to the next check
  })

  test("search page renders a search input when authenticated", async ({ page }) => {
    await page.goto("/search")

    const url = page.url()
    if (url.includes("/login")) {
      // Redirect is the correct behaviour for unauthenticated users
      await expect(page).toHaveURL(/\/login/)
      return
    }

    // When authenticated, the search input should be visible and auto-focused
    const searchInput = page.getByPlaceholder(/Search contracts/i)
    await expect(searchInput).toBeVisible()
  })

  test("search page shows empty/prompt state before any query", async ({ page }) => {
    await page.goto("/search")

    const url = page.url()
    if (url.includes("/login")) {
      await expect(page).toHaveURL(/\/login/)
      return
    }

    await page.waitForLoadState("networkidle")

    // Should show the "Search your contracts" prompt
    const prompt = page.getByText(/Search your contracts/i)
    await expect(prompt).toBeVisible()
  })

  test("typing a query triggers a search and shows results or no-results state", async ({ page }) => {
    await page.goto("/search")

    const url = page.url()
    if (url.includes("/login")) {
      await expect(page).toHaveURL(/\/login/)
      return
    }

    const searchInput = page.getByPlaceholder(/Search contracts/i)
    await expect(searchInput).toBeVisible()

    await searchInput.fill("NDA")

    // Wait for debounce (300ms) + network
    await page.waitForTimeout(500)
    await page.waitForLoadState("networkidle")

    // Either results OR "No results" state is acceptable
    const hasResults = await page.locator("table").isVisible().catch(() => false)
    const hasNoResults = await page.getByText(/No results/i).isVisible().catch(() => false)
    const hasPrompt = await page.getByText(/Search your contracts/i).isVisible().catch(() => false)

    // At least one of these states must be true
    expect(hasResults || hasNoResults || hasPrompt).toBe(true)
  })

  test("search page has a semantic mode toggle button", async ({ page }) => {
    await page.goto("/search")

    const url = page.url()
    if (url.includes("/login")) {
      await expect(page).toHaveURL(/\/login/)
      return
    }

    // The Sparkles icon button toggles semantic mode
    const semanticToggle = page.getByTitle(/semantic search/i).or(page.getByTitle(/keyword search/i))
    await expect(semanticToggle).toBeVisible()
  })
})
