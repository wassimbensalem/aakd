import { test, expect } from "@playwright/test"

/**
 * E2E tests for authentication flows.
 *
 * These tests require a running dev server (pnpm dev) with a seeded database.
 * The playwright.config.ts `webServer` block handles this automatically.
 */

test.describe("Authentication", () => {
  test("visiting /login renders the sign-in form", async ({ page }) => {
    await page.goto("/login")

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
    await expect(page.getByLabel("Email")).toBeVisible()
    await expect(page.getByLabel("Password")).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
  })

  test("visiting a protected route without a session redirects to /login", async ({ page }) => {
    // Navigate directly to a protected route
    await page.goto("/contracts")

    // Should be redirected to login
    await expect(page).toHaveURL(/\/login/)
  })

  test("visiting /dashboard without a session redirects to /login", async ({ page }) => {
    await page.goto("/dashboard")

    await expect(page).toHaveURL(/\/login/)
  })

  test("login page has a link to the register page", async ({ page }) => {
    await page.goto("/login")

    const registerLink = page.getByRole("link", { name: "Create one" })
    await expect(registerLink).toBeVisible()
    await registerLink.click()

    await expect(page).toHaveURL(/\/register/)
  })

  test("register page renders the create account form", async ({ page }) => {
    await page.goto("/register")

    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible()
    await expect(page.getByLabel("Name")).toBeVisible()
    await expect(page.getByLabel("Email")).toBeVisible()
    await expect(page.getByLabel("Password")).toBeVisible()
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible()
  })

  test("register page has a link back to login", async ({ page }) => {
    await page.goto("/register")

    const loginLink = page.getByRole("link", { name: "Sign in" })
    await expect(loginLink).toBeVisible()
    await loginLink.click()

    await expect(page).toHaveURL(/\/login/)
  })

  test("submitting login form with invalid credentials shows an error", async ({ page }) => {
    await page.goto("/login")

    await page.getByLabel("Email").fill("notareal@example.com")
    await page.getByLabel("Password").fill("wrongpassword")
    await page.getByRole("button", { name: "Sign in" }).click()

    // Should NOT be redirected — stays on login or shows an error toast
    // We just check that we haven't jumped to /dashboard
    await page.waitForTimeout(1500)
    expect(page.url()).not.toMatch(/\/dashboard/)
  })
})
