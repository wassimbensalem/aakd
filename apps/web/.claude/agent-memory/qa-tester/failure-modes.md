---
name: ClauseFlow M0 failure modes
description: Known failure patterns in ClauseFlow M0 codebase — save QA re-discovery cycles
type: feedback
---

## jsdom + Request.formData()

vitest runs in jsdom. `Request.formData()` fails silently — the route catches it and returns 400 "Invalid form data" instead of the expected 415/413.

**Fix**: Use `Object.defineProperty(req, "formData", { value: () => Promise.resolve(fd) })` to inject a real `FormData` with a real `File` object. Plain object mocks fail `instanceof File` check in the route.

**Why**: jsdom doesn't implement multipart FormData parsing on Request.

## vi.resetModules() kills setup.ts mocks

Calling `vi.resetModules()` in `beforeEach` clears the global mocks from `tests/setup.ts` (prisma mock). Subsequent `prisma.X.findUnique` calls return `undefined`, causing routes to return unexpected 400/404 instead of the intended response.

**Fix**: Never use `vi.resetModules()` in beforeEach. Use `vi.clearAllMocks()` only.

## vi.mock() inside describe blocks — hoisting warning

vitest hoists `vi.mock()` to module top level regardless of where it's written. Inline `vi.mock()` inside describe blocks triggers a hoisting warning and can cause unexpected behavior when the same module is mocked differently in different test files.

**Fix**: All `vi.mock()` calls must be at the top level of the test file.

## No status transition guard on contracts

Contracts can be moved from any status to any status (e.g., ACTIVE → DRAFT, ARCHIVED → DRAFT) without validation. This is by design for M0 but should be documented. Do not assume a 422 when patching to a "backwards" status.

## Double-archive is idempotent (no guard)

Calling DELETE on an already-ARCHIVED contract returns 204 again. The route does not check current status. Not a blocker for M0 but worth a story for M1.

## pgvector in docker-compose (scope creep)

docker-compose.yml uses `pgvector/pgvector:pg16` as the postgres image. This is M1+ infrastructure. For M0 a plain `postgres:16` image is sufficient. Not a runtime bug but signals future confusion.

## REDIS_URL in docker-compose environment (scope creep)

The app service has `REDIS_URL: redis://redis:6379` set but there is no redis service in the compose file. This env var is dead for M0. The app doesn't fail to start because nothing reads it at runtime, but it's confusing.
