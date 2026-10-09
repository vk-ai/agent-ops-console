"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { ConsoleConfig } from "@/lib/types";
import { useRuns } from "./RunStreamProvider";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/runs", label: "Runs" },
  { href: "/approvals", label: "Approvals" },
  { href: "/memories", label: "Memory" },
  { href: "/permissions", label: "Tool permissions" },
];

export function Nav() {
  const pathname = usePathname();
  const { runs, transport } = useRuns();
  const [cfg, setCfg] = useState<ConsoleConfig | null>(null);
  useEffect(() => {
    api.config().then(setCfg, () => setCfg(null));
  }, []);
  const pending = runs.filter((r) => r.status === "waiting_approval").length;
  return (
    <header className="nav">
      <div className="brand">agent-ops-console</div>
      <nav aria-label="main">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname?.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={active ? "active" : undefined}>
              {l.label}
              {l.href === "/approvals" && pending > 0 && (
                <span className="count" aria-label={`${pending} pending approvals`}>{pending}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="modes" data-testid="modes">
        <span className={`mode mode-${cfg?.runtimeMode ?? "unknown"}`}>runtime: {cfg?.runtimeMode ?? "…"}</span>
        <span className={`mode mode-${cfg?.hubMode ?? "unknown"}`}>hub: {cfg?.hubMode ?? "…"}</span>
        <span className="mode" data-testid="transport">updates: {transport === "sse" ? "SSE" : transport}</span>
      </div>
    </header>
  );
}
