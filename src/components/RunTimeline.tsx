import { buildTimeline, formatTs, runEvents } from "@/lib/timeline";
import type { RunView } from "@/lib/types";

const ICON: Record<string, string> = {
  done: "✓", running: "●", waiting: "⏸", failed: "✕", skipped: "–", pending: "○",
};

export function RunTimeline({ run }: { run: RunView }) {
  const nodes = buildTimeline(run);
  return (
    <section aria-label="run timeline">
      <ol className="timeline" aria-label="graph nodes">
        {nodes.map((n) => (
          <li key={n.node} className={`tl tl-${n.state}`} data-state={n.state}>
            <span className="tl-icon" aria-hidden>{ICON[n.state]}</span>
            <span className="tl-node">{n.node}</span>
            <span className="tl-state">{n.state}{n.order ? ` · step ${n.order}` : ""}</span>
            {n.note && <span className="tl-note">{n.note}</span>}
          </li>
        ))}
      </ol>
      <ul className="events" aria-label="run events">
        {runEvents(run).map((e, i) => (
          <li key={i}>
            <time>{formatTs(e.at)}</time> {e.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
