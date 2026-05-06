## What

<!-- One sentence: what does this PR do? -->

## Why

<!-- Why is this change needed? Link to issue if applicable. Closes #xxx -->

## Changes

<!-- Bullet list of what changed -->

## Test plan

- [ ] Unit tests pass (`pnpm test`)
- [ ] TypeScript compiles (`pnpm typecheck`)
- [ ] Org isolation test passes (`pnpm test:isolation`)
- [ ] Tested manually against `docker-compose.dev.yml`

## Checklist

- [ ] No AI/approval/signing code in M0 (scope gate)
- [ ] Every API route calls `resolveAuth()` — no unprotected routes
- [ ] Every contract mutation writes to `Activity` table
- [ ] Returns 404 (not 403) for cross-org resource access
- [ ] Zod validation on all request bodies
- [ ] No raw API keys stored in DB (bcrypt hash only)
