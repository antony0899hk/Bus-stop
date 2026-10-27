# AI Dev Workflow V1 — Bus-stop

This repository uses a lightweight ChatGPT (planner/reviewer) + Codex (implementer) workflow. This document is guidance, not an autonomous bridge.

## Roles
- Owner: decides requirements, approves merges and production deployment.
- ChatGPT: translates requests into scoped acceptance criteria, reviews proposed diffs and test evidence, reports risks.
- Codex: implements changes on a dedicated branch, runs available checks, opens a pull request with evidence.

## Rules
1. Never modify `main` directly for feature work. Create a dedicated branch and PR.
2. Before coding, inspect README, ARCHITECTURE, package scripts, and relevant source files. Do not assume frameworks or tests.
3. Keep each change small and limited to the requested feature; preserve existing transit operators and ETA behavior.
4. Never invent transport timetables, route availability, GPS positions or API responses.
5. Verify behavior for both directions, no-data/error states, mobile Safari, and nearby-stop expansion where applicable.
6. Run existing checks if available. Report exactly which commands ran, their results, and what could not be tested. Never claim unrun tests passed.
7. Do not expose credentials, add third-party services, install remote scripts, or change deployment settings without explicit approval.
8. No automatic merge or production deployment. Require owner's explicit approval after review.
9. If requirements are ambiguous or risky, stop and ask rather than guessing.

## Request handoff template
**Goal:**
**Current behavior / reproduction:**
**Expected behavior:**
**In scope:**
**Out of scope:**
**Acceptance criteria:**
**Risk / rollback:**

## PR review template
- Summary of files and behavior changed
- Tests performed and results
- Screenshots / manual verification where relevant
- Known limitations and regressions to watch
- Rollback plan
- Reviewer verdict: approve / request changes / needs manual testing

## First candidate test (not yet implemented)
Investigate why MTR may be missing from point-to-point journey options. Diagnose data and filtering first; propose a small fix with regression tests. Do not change production routing until reviewed.
