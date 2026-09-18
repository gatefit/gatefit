import type { AccessAdapter } from "../access-adapter.ts";
import { applyBillingEvent, emptyStore } from "../access-rules.ts";

export function createAdapter(): AccessAdapter {
  const store = emptyStore();
  return {
    apply(event) {
      applyBillingEvent(store, event);
    },
    snapshot(customerId) {
      return store.rows.get(customerId) ?? { locked: true };
    },
    reset() {
      store.rows.clear();
      store.seen.clear();
    },
  };
}

export default createAdapter;
