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

Harness integrity (required agent files present; no OtoPilot-only detekt/iOS hooks or `deploy-ios` skill).

## What it will cover later

When `tests/entitlements/` exists, a later High must wire the entitlement runner into `./ci-local.sh`. Until then, do not invent a second gate.

## Merge

GitHub Actions `ci.yml` runs the same script. A local green never overrides a GHA red. Never merge unless the user says **Merge it**.
