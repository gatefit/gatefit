#!/usr/bin/env bash
set -euo pipefail
if [[ -f "${GITHUB_ACTION_PATH}/package.json" && -f "${GITHUB_ACTION_PATH}/bin/gatefit.js" ]]; then
  GATEFIT_ROOT="${GITHUB_ACTION_PATH}"
else
  GATEFIT_ROOT="$(cd "${GITHUB_ACTION_PATH}/../../.." && pwd)"
fi
ADAPTER="$(cd "${GITHUB_WORKSPACE}" && realpath "${GATEFIT_ADAPTER_INPUT}")"
if [[ -n "${GATEFIT_SUITE_INPUT}" && -e "${GITHUB_WORKSPACE}/${GATEFIT_SUITE_INPUT}" ]]; then
  SUITE="$(cd "${GITHUB_WORKSPACE}" && realpath "${GATEFIT_SUITE_INPUT}")"
elif [[ -n "${GATEFIT_SUITE_INPUT}" ]]; then
  SUITE="${GATEFIT_SUITE_INPUT}"
else
  SUITE="${GATEFIT_ROOT}/tests/entitlements/goldens"
fi
cd "${GATEFIT_ROOT}"
npm install --ignore-scripts
node "${GATEFIT_ROOT}/bin/gatefit.js" run --suite "${SUITE}" --adapter "${ADAPTER}"
