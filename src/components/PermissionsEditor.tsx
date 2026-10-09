"use client";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import {
  allTools,
  grantSource,
  orphanGrants,
  PolicyEngine,
  setGrant,
  setInherits,
  setRateLimit,
  toolsFor,
  validatePolicy,
} from "@/lib/policy";
import type { Policy, PolicyDecision } from "@/lib/types";

/**
 * Per-tool permissions in the hub's RBAC model (mcp_hub/policy.py):
 * roles grant tools and inherit from other roles; each tool may restrict
 * arguments and carry a rate limit. Unknown tools are always denied.
 */
export function PermissionsEditor({ hubSkills }: { hubSkills?: string[] }) {
  const [saved, setSaved] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [store, setStore] = useState<"memory" | "file">("memory");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPolicy().then(
      (r) => {
        setSaved(r.policy);
        setDraft(r.policy);
        setStore(r.store);
      },
      (e) => setError(String(e)),
    );
  }, []);

  const validation = useMemo(() => {
    if (!draft) return null;
    try {
      validatePolicy(draft);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [draft]);

  if (error && !draft) return <p role="alert" className="error">{error}</p>;
  if (!draft || !saved) return <p>Loading policy…</p>;

  const roles = Object.keys(draft.roles);
  const tools = allTools(draft);
  const orphans = new Set(orphanGrants(draft));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    setStatus(null);
    setError(null);
    try {
      const r = await api.putPolicy(draft);
      setSaved(r.policy);
      setDraft(r.policy);
      setStatus(
        r.store === "file"
          ? "Saved to the hub's policy.json. Restart mcp-hub serve to apply it."
          : "Saved (in-memory copy; mock mode).",
      );
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.detail}` : String(e));
    }
  };

  return (
    <div className="stack">
      <p className="muted">
        Policy store: <strong>{store === "file" ? "hub policy.json file" : "in-memory copy of the hub default"}</strong>.
        The hub has no policy API; it reads this file at startup.
      </p>

      <table className="table matrix" aria-label="permission matrix">
        <thead>
          <tr>
            <th>Tool</th>
            {roles.map((r) => <th key={r}>{r}</th>)}
            <th>Argument rules</th>
            <th>Rate limit</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => {
            const spec = draft.tools[tool];
            const rl = spec?.rate_limit;
            return (
              <tr key={tool} data-tool={tool}>
                <td>
                  <code>{tool}</code>
                  {orphans.has(tool) && <span className="warn" title="granted but has no tool spec: the hub denies it as unknown_tool"> no spec → denied</span>}
                  {hubSkills && !hubSkills.includes(tool) && spec && <span className="muted"> (not an MCP/A2A skill)</span>}
                </td>
                {roles.map((role) => {
                  const src = grantSource(draft, role, tool);
                  return (
                    <td key={role} className={`cell cell-${src.kind}`}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${role} can use ${tool}`}
                          checked={src.kind === "direct"}
                          onChange={(e) => setDraft(setGrant(draft, role, tool, e.target.checked))}
                        />
                        {src.kind === "inherited" && <span className="via">via {src.via}</span>}
                      </label>
                    </td>
                  );
                })}
                <td className="args">
                  {Object.entries(spec?.args ?? {}).map(([arg, rule]) => (
                    <div key={arg}>
                      <code>{arg}</code>{" "}
                      {rule.allow ? `∈ {${rule.allow.join(", ")}}` : null}
                      {rule.pattern ? `~ /${rule.pattern}/` : null}
                    </div>
                  ))}
                  {!spec?.args && <span className="muted">any</span>}
                </td>
                <td>
                  {spec ? (
                    <span className="rl">
                      <input
                        type="number"
                        min={0}
                        aria-label={`${tool} max calls`}
                        value={rl?.max ?? ""}
                        placeholder="∞"
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraft(setRateLimit(draft, tool, v === "" ? null : { max: Number(v), per_seconds: rl?.per_seconds ?? 60 }));
                        }}
                      />
                      / 
                      <input
                        type="number"
                        min={1}
                        aria-label={`${tool} window seconds`}
                        value={rl?.per_seconds ?? ""}
                        disabled={!rl}
                        onChange={(e) => rl && setDraft(setRateLimit(draft, tool, { max: rl.max, per_seconds: Number(e.target.value) }))}
                      />
                      s
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section aria-label="role inheritance">
        <h2>Role inheritance</h2>
        {roles.map((role) => (
          <div key={role} className="row">
            <strong>{role}</strong> inherits:
            {roles.filter((r) => r !== role).map((parent) => {
              const on = (draft.roles[role].inherits ?? []).includes(parent);
              return (
                <label key={parent} className="inline">
                  <input
                    type="checkbox"
                    aria-label={`${role} inherits ${parent}`}
                    checked={on}
                    onChange={() => {
                      const cur = draft.roles[role].inherits ?? [];
                      setDraft(setInherits(draft, role, on ? cur.filter((p) => p !== parent) : [...cur, parent]));
                    }}
                  />
                  {parent}
                </label>
              );
            })}
            <span className="muted"> → {[...toolsFor(draft, [role])].length} tools</span>
          </div>
        ))}
      </section>

      {validation && <p role="alert" className="error">Invalid policy: {validation}</p>}
      <div className="buttons">
        <button onClick={save} disabled={!dirty || !!validation}>Save policy</button>
        <button className="secondary" onClick={() => setDraft(saved)} disabled={!dirty}>Discard changes</button>
        <a
          className="button secondary"
          download="policy.json"
          href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(draft, null, 2))}`}
        >
          Download policy.json
        </a>
      </div>
      {status && <p role="status" className="ok">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}

      {!validation && <Simulator policy={draft} />}
    </div>
  );
}

export function Simulator({ policy }: { policy: Policy }) {
  const roles = Object.keys(policy.roles);
  const tools = allTools(policy);
  const [picked, setPicked] = useState<string[]>([roles[0]].filter(Boolean));
  const [tool, setTool] = useState(tools[0] ?? "");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<PolicyDecision | string | null>(null);

  return (
    <section className="card" aria-label="policy simulator">
      <h2>Simulate a tool call</h2>
      <p className="muted">Runs the TypeScript port of the hub&apos;s PolicyEngine on the draft above. Rate limits start fresh on each check.</p>
      <div className="row">
        {roles.map((r) => (
          <label key={r} className="inline">
            <input
              type="checkbox"
              aria-label={`principal has ${r}`}
              checked={picked.includes(r)}
              onChange={() => setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))}
            />
            {r}
          </label>
        ))}
      </div>
      <div className="row">
        <label>
          Tool
          <select value={tool} onChange={(e) => setTool(e.target.value)} aria-label="tool">
            {tools.map((t) => <option key={t}>{t}</option>)}
            <option value="drop_database">drop_database (not in policy)</option>
          </select>
        </label>
        <label className="grow">
          Arguments (JSON)
          <input value={args} onChange={(e) => setArgs(e.target.value)} aria-label="arguments" />
        </label>
        <button
          onClick={() => {
            try {
              const parsed = JSON.parse(args);
              setResult(new PolicyEngine(policy).evaluate({ id: "sim", tenant: "acme", roles: picked }, tool, parsed));
            } catch (e) {
              setResult(`bad input: ${(e as Error).message}`);
            }
          }}
        >
          Check
        </button>
      </div>
      {result && (
        <p data-testid="decision" className={typeof result === "string" || !result.allowed ? "error" : "ok"}>
          {typeof result === "string"
            ? result
            : result.allowed
              ? `allow (role ${result.matched_role})`
              : `deny: ${result.reason}`}
        </p>
      )}
    </section>
  );
}
