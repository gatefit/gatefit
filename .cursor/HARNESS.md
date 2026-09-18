# Cursor Cloud harness

This is the session bible for **Cursor Cloud Agents** and anyone starting a Cursor session on Gatefit.

There is no Codex/Claude loop kit in this repo. Do not invent one.

## Always read

- `.cursor/rules/gatefit-cloud.mdc` (always-on)
- This file

## Coding policy

- Product and code conventions: `CLAUDE.md`
- Root `AGENTS.md` is the Cursor **coding-session entry** (product one-liner + how agents work here). It is not a Gemini product-AI spec.

## Verify and merge

- Before opening or updating a PR, run `./ci-local.sh`.
- GitHub Actions (`.github/workflows/ci.yml`) is source of truth for merges. A local green never overrides a GHA red.
- Never merge unless the user says **Merge it**. Cursor does not auto-merge.

## Review bar

Cloud Agent PRs need two independent verdicts (correctness + security) **or** an explicit `human-review` label / “human review substitutes” note in the PR.

Cursor does **not** start Codex fleet reviewers. Humans or later bots cover that outside this repo.

## Anti-thrash

- HOLD fix-ups: continue on the **same cloud agent / same branch**. Do not spawn duplicate agents for the same ticket.
- Do not re-read the same large files in a loop; summarize and move on.
- Empty-death: if the queue is empty / no eligible work / blocked on a human, stop cleanly — idle is valid.
- Do not implement product features by “chat coding” without the named verify gate. No drive-by refactors or extra PRs outside the asked scope.

## Project coordinator

Ops contract for the Cursor **Project coordinator**. Product FREEZE is separate; this section is ops only.

- **Announce** worker `bcId` on spawn (plus High id `gatefit#N` when one exists), on abort (`bcId` + reason; spawn a replacement from `main` if the High is still open), and on PR-up (`bcId` + PR URL). Keep a short chat registry: High → worker bcId → PR.
- **Fresh branch from up-to-date `main` per High.** Never reuse a prior High’s PR or branch.
- **Success** is a High-titled PR on that fresh branch. Title/body cite `gatefit#N` when a High exists. Highs are GitHub issues on `edipert/gatefit` until Linear capacity returns.
- **Coordinator `CloudAgent get` PR/branch is untrusted after the first High.** Ignore poisoned/stale get fields. After a High closes, say “High closed — ignore coordinator CloudAgent get PR/branch for the next High.”
- **Empty-death (ships):** commits without push → same-worker push + PR only. Zero commits / plan missing → same-worker Extra High full implement (or a fresh worker from `main` if that worker is dead). Do not abort a live ship for Extra High without recording its `bcId`. Do not spawn parallel workers for the same High unless Lead asks.

## Plugins

Account plugins own `using-superpowers`, pstack, and superdesign. Use them when the launch prompt names them. Do not reinvent them in-repo.

## Out of scope / never

- Do not run Codex harness loops (`exec`, `fleet`, `audit`, `metrics`, `plan`, `content`, `cycle`, `evolve`).
- Do not invent `/harness-*` skills, `.agents/skills/harness-*`, root `HARNESS.md` loops, or `docs/harness/HOW-TO-USE.md`.
- Do not invoke `.codex/` agents.
- Do not paste OtoPilot mobile/panel/web, detekt, or iOS deploy paths.
