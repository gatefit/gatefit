# Gatefit — agent entry

**Product:** Stripe Entitlement Edge Pack — CI that asserts the access DB survives ugly billing transitions.

This file is the Cursor **coding-session entry** for `edipert/gatefit`. It is not a product-AI / Gemini blueprint.

## How agents work here

1. Read `.cursor/HARNESS.md` (Cloud session bible) and `.cursor/rules/gatefit-cloud.mdc` (always-on).
2. Follow `CLAUDE.md` for product and code conventions.
3. Testing: for complex features, prefer E2E as the sole mechanism and end on a repeatable artifact (fixture golden, `./ci-local.sh`, Action smoke). Never write unit tests after code. Encode failure modes first, then implementation. Full rules: `.cursor/HARNESS.md` Testing and `CLAUDE.md`.
4. Named verify gate: run `./ci-local.sh` before opening or updating a PR.
5. GitHub Actions (`ci.yml`) is source of truth for merges. A local green never overrides a GHA red.
6. Never merge unless the user says **Merge it**.
7. Fresh branch from up-to-date `main` per High. Cite `gatefit#N` in the PR title and body. Do not reuse another High’s PR or branch.
8. Empty-death: if the queue is empty, there is no eligible work, or you are blocked on a human, stop cleanly — idle is valid.

Highs are GitHub issues on this repo (`gatefit#N`) until Linear capacity returns. Cursor Project: `bc-0e25cb1c-5f8c-45e6-887e-4641b51f68a8`.

Do not run Codex/Claude loop kits, invent a root `HARNESS.md` loop, or follow a `HOW-TO-USE` playbook. Those are out of scope for Gatefit.
