---
name: verify-gate
description: Run Gatefit's named verify gate (./ci-local.sh) before opening or updating a PR, and before claiming the harness or entitlement pack is green.
---

# Gatefit verify gate

Use this skill whenever you are about to open a PR, update a PR, or claim work is complete.

## Command

```bash
./ci-local.sh
```

Exit 0 is green. Treat any non-zero as blocking.

## What it covers today

- Harness integrity (required agent files present; no OtoPilot-only detekt/iOS hooks or `deploy-ios` skill).
- Entitlement CLI: `gatefit adapter-check` (naive fails S1 / hardened passes S1).
- Hardened S1/S2 goldens: `paid_grants_access` and `cancel_revokes_access`.
- `tests/entitlements/*.test.ts`.

## Merge

GitHub Actions `ci.yml` runs the same script. A local green never overrides a GHA red. Never merge unless the user says **Merge it**. Edip OVERRIDE for GATEFIT-H2: GHA billing may skip — do not block this High on Actions.
