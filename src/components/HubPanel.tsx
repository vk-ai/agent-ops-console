"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatTs } from "@/lib/timeline";
import type { AgentCard, AuditVerify, Connection } from "@/lib/types";
import { PermissionsEditor } from "./PermissionsEditor";

export function HubPanel() {
  const [card, setCard] = useState<AgentCard | null>(null);
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [audit, setAudit] = useState<AuditVerify | string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.hubCard().then(setCard, (e) => setErr(`agent card: ${e.message}`));
    api.hubConnections().then(setConns, (e) => setErr(`connections: ${e.message}`));
    api.hubAudit().then(setAudit, (e) => setAudit(`unavailable (${e.message})`));
  }, []);

  return (
    <div className="stack">
      <PermissionsEditor hubSkills={card?.skills.map((s) => s.id)} />
      <section className="card" aria-label="hub status">
        <h2>Hub</h2>
        {err && <p className="error">{err}</p>}
        {card && (
          <p>
            <strong>{card.name}</strong> v{card.version} · A2A {card.protocolVersion} · {card.skills.length} skills ·
            streaming: {String(card.capabilities.streaming)}
          </p>
        )}
        <h3>Connections</h3>
        {conns && conns.length === 0 && <p className="muted">No OAuth connections for this tenant.</p>}
        <ul className="list">
          {conns?.map((c) => (
            <li key={c.provider}>
              <strong>{c.provider}</strong> as {c.subject} · scope <code>{c.scope}</code> · expires {formatTs(c.expires_at)}
            </li>
          ))}
        </ul>
        <h3>Audit chain</h3>
        <p data-testid="audit">
          {audit === null
            ? "…"
            : typeof audit === "string"
              ? audit
              : audit.intact
                ? `intact (${audit.entries} entries)`
                : `BROKEN at seq ${audit.first_bad_seq}`}
        </p>
      </section>
    </div>
  );
}
