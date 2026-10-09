/**
 * Where the console reads and saves the hub's RBAC policy.
 *
 * mcp-integration-hub has no HTTP endpoint for its policy: PolicyEngine loads
 * mcp_hub/config/policy.json at startup. So the console either
 *  - edits that JSON file directly (HUB_POLICY_FILE=/path/to/policy.json); the
 *    hub picks the change up on its next restart, or
 *  - keeps an in-memory copy seeded from the hub's default policy (mock mode).
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import defaultPolicy from "../default-policy.json";
import { validatePolicy } from "../policy";
import type { Policy } from "../types";

export interface PolicyStore {
  readonly kind: "memory" | "file";
  get(): Promise<Policy>;
  put(policy: Policy): Promise<Policy>;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export class MemoryPolicyStore implements PolicyStore {
  readonly kind = "memory" as const;
  private policy: Policy;
  constructor(initial: Policy = defaultPolicy as Policy) {
    this.policy = clone(initial);
  }
  async get() {
    return clone(this.policy);
  }
  async put(policy: Policy) {
    validatePolicy(policy);
    this.policy = clone(policy);
    return this.get();
  }
}

export class FilePolicyStore implements PolicyStore {
  readonly kind = "file" as const;
  constructor(private path: string) {}
  async get(): Promise<Policy> {
    return JSON.parse(await readFile(this.path, "utf8"));
  }
  async put(policy: Policy): Promise<Policy> {
    validatePolicy(policy);
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(policy, null, 2) + "\n", "utf8");
    await rename(tmp, this.path);
    return this.get();
  }
}
