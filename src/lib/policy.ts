/**
 * TypeScript port of mcp_hub/policy.py `PolicyEngine`, used to show and edit
 * per-tool permissions and to simulate a decision before saving a policy.
 *
 * Semantics kept identical to the Python engine (see tests/unit/policy.test.ts,
 * which mirrors the hub's tests/test_policy.py, and the optional live parity
 * check in tests/integration):
 *  - roles inherit tools from their parents, transitively; cycles and unknown
 *    parents are rejected
 *  - a tool missing from `tools` is denied ("unknown_tool"), even for admin
 *  - argument rules apply to every role; values are `str()`-ed and patterns
 *    must match the whole string (Python `re.fullmatch`)
 *  - fixed-window rate limit per (tenant, principal, tool); denied calls do
 *    not consume quota
 */
import type { Policy, PolicyDecision, Principal, RateLimit } from "./types";

export class PolicyError extends Error {}

export function validatePolicy(policy: Policy): void {
  if (!policy || typeof policy !== "object" || typeof policy.roles !== "object" || typeof policy.tools !== "object") {
    throw new PolicyError("policy must have 'roles' and 'tools' objects");
  }
  const roles = policy.roles;
  for (const [name, spec] of Object.entries(roles)) {
    for (const parent of spec.inherits ?? []) {
      if (!(parent in roles)) throw new PolicyError(`role '${name}' inherits unknown role '${parent}'`);
    }
    const seen = new Set<string>();
    const walk = (r: string) => {
      if (seen.has(r)) throw new PolicyError(`role inheritance cycle at '${r}'`);
      seen.add(r);
      for (const p of roles[r]?.inherits ?? []) walk(p);
    };
    walk(name);
  }
  for (const [tool, spec] of Object.entries(policy.tools)) {
    for (const [arg, rule] of Object.entries(spec.args ?? {})) {
      if (rule.pattern !== undefined) {
        try {
          new RegExp(rule.pattern);
        } catch {
          throw new PolicyError(`tool '${tool}' arg '${arg}' has an invalid pattern`);
        }
      }
    }
    const rl = spec.rate_limit;
    if (rl && (!(rl.max >= 0) || !(rl.per_seconds > 0))) {
      throw new PolicyError(`tool '${tool}' has an invalid rate_limit`);
    }
  }
}

export function effectiveRoles(policy: Policy, roles: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const walk = (r: string) => {
    if (out.has(r) || !(r in policy.roles)) return;
    out.add(r);
    for (const p of policy.roles[r].inherits ?? []) walk(p);
  };
  for (const r of roles) walk(r);
  return out;
}

export function toolsFor(policy: Policy, roles: Iterable<string>): Set<string> {
  const tools = new Set<string>();
  for (const r of effectiveRoles(policy, roles)) for (const t of policy.roles[r].tools ?? []) tools.add(t);
  return tools;
}

function fullmatch(pattern: string, value: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test(value);
}

export class PolicyEngine {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    readonly policy: Policy,
    private clock: () => number = () => Date.now() / 1000,
  ) {
    validatePolicy(policy);
  }

  evaluate(principal: Principal, tool: string, args: Record<string, unknown>): PolicyDecision {
    const spec = this.policy.tools[tool];
    if (spec === undefined) return { allowed: false, reason: "unknown_tool", matched_role: null };
    const matched =
      [...effectiveRoles(this.policy, principal.roles)].find((r) =>
        (this.policy.roles[r].tools ?? []).includes(tool),
      ) ?? null;
    if (matched === null) return { allowed: false, reason: "role_not_permitted", matched_role: null };
    for (const [arg, rule] of Object.entries(spec.args ?? {})) {
      const raw = args[arg];
      const value = raw === undefined ? "" : String(raw);
      if (rule.allow !== undefined && !rule.allow.includes(value)) {
        return { allowed: false, reason: `arg_not_allowed:${arg}`, matched_role: null };
      }
      if (rule.pattern !== undefined && !fullmatch(rule.pattern, value)) {
        return { allowed: false, reason: `arg_not_allowed:${arg}`, matched_role: null };
      }
    }
    if (spec.rate_limit && !this.consume(principal, tool, spec.rate_limit)) {
      return { allowed: false, reason: "rate_limited", matched_role: null };
    }
    return { allowed: true, reason: "ok", matched_role: matched };
  }

  private consume(p: Principal, tool: string, limit: RateLimit): boolean {
    const key = JSON.stringify([p.tenant, p.id, tool]);
    const w = this.windows.get(key) ?? { start: 0, count: 0 };
    this.windows.set(key, w);
    const now = this.clock();
    if (now - w.start >= limit.per_seconds) {
      w.start = now;
      w.count = 0;
    }
    if (w.count >= limit.max) return false;
    w.count += 1;
    return true;
  }
}

// ------------------------------------------------------------ editor helpers

export type GrantSource = { kind: "direct" } | { kind: "inherited"; via: string } | { kind: "none" };

/** Where a role gets a tool from: granted directly, inherited (via which ancestor), or not at all. */
export function grantSource(policy: Policy, role: string, tool: string): GrantSource {
  if ((policy.roles[role]?.tools ?? []).includes(tool)) return { kind: "direct" };
  const ancestors = [...effectiveRoles(policy, [role])].filter((r) => r !== role);
  const via = ancestors.find((r) => (policy.roles[r].tools ?? []).includes(tool));
  return via ? { kind: "inherited", via } : { kind: "none" };
}

/** All tools mentioned anywhere: tool specs plus role grants (a grant without a spec is still denied). */
export function allTools(policy: Policy): string[] {
  const s = new Set(Object.keys(policy.tools));
  for (const r of Object.values(policy.roles)) for (const t of r.tools ?? []) s.add(t);
  return [...s].sort();
}

/** Tools granted to some role but missing a `tools` spec: the hub denies these as unknown_tool. */
export function orphanGrants(policy: Policy): string[] {
  return allTools(policy).filter((t) => !(t in policy.tools));
}

export function setGrant(policy: Policy, role: string, tool: string, granted: boolean): Policy {
  const spec = policy.roles[role] ?? {};
  const tools = new Set(spec.tools ?? []);
  if (granted) tools.add(tool);
  else tools.delete(tool);
  return { ...policy, roles: { ...policy.roles, [role]: { ...spec, tools: [...tools] } } };
}

export function setInherits(policy: Policy, role: string, parents: string[]): Policy {
  const spec = policy.roles[role] ?? {};
  const next: Policy = { ...policy, roles: { ...policy.roles, [role]: { ...spec, inherits: parents } } };
  if (parents.length === 0) delete next.roles[role].inherits;
  return next;
}

export function setRateLimit(policy: Policy, tool: string, limit: RateLimit | null): Policy {
  const spec = { ...(policy.tools[tool] ?? {}) };
  if (limit) spec.rate_limit = limit;
  else delete spec.rate_limit;
  return { ...policy, tools: { ...policy.tools, [tool]: spec } };
}
