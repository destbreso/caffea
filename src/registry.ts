import type { EvictionPolicy } from "./policy";
import { LRU, LFU } from "./policy";
import { WTinyLFU } from "./w-tinylfu";

/**
 * Makes a fresh policy instance. The registry stores factories, not instances,
 * because a policy is stateful (it owns the entries' ordering) and is bound to a
 * single cache by `init`. Every `new Cache(cap, { policy: "name" })` gets its own
 * instance from the factory.
 */
export type PolicyFactory = () => EvictionPolicy<unknown, unknown>;

const registry = new Map<string, PolicyFactory>();

/**
 * Register a named eviction policy so it can be selected by string:
 * `new Cache(cap, { policy: "my-policy" })`. This is what makes the string
 * selector worth having: it adapts to your own policies, not just the built-ins.
 * Re-registering a name replaces it, so you can override a built-in (for example,
 * register `"w-tinylfu"` as a `WTinyLFU` tuned with your own `hash`).
 */
export function registerPolicy(name: string, factory: PolicyFactory): void {
  registry.set(name, factory);
}

/** The names currently registered: the built-ins plus anything you added. */
export function policyNames(): string[] {
  return [...registry.keys()];
}

/**
 * Resolve a registered name to a FRESH policy instance. Throws a helpful
 * `RangeError` if the name is unknown. The result is typed to the caller's `K`,
 * `V`: a name carries no type information, so string selection trades static
 * safety for convenience. Pass a policy instance instead for full type checking.
 */
export function createPolicy<K, V>(name: string): EvictionPolicy<K, V> {
  const factory = registry.get(name);
  if (factory === undefined) {
    const known = policyNames()
      .map((n) => `"${n}"`)
      .join(", ");
    throw new RangeError(
      `Unknown eviction policy "${name}". Registered: ${known}. ` +
        `Add one with registerPolicy("${name}", () => new MyPolicy()).`,
    );
  }
  return factory() as unknown as EvictionPolicy<K, V>;
}

// The built-ins, available by name out of the box.
registerPolicy("w-tinylfu", () => new WTinyLFU());
registerPolicy("lru", () => new LRU());
registerPolicy("lfu", () => new LFU());
