"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api-client";
import { applyRunEvent } from "./stream";
import type { RunRecord, RunStreamEvent } from "./types";

export type Transport = "connecting" | "sse" | "polling";

export interface RunStreamState {
  runs: RunRecord[];
  transport: Transport;
  error: string | null;
  /** Bumps on every event so pages can refetch details. */
  version: number;
  lastEvent: RunStreamEvent | null;
}

/**
 * Live list of runs: SSE from /api/stream/runs, falling back to polling
 * /api/runtime/runs every `pollMs` when EventSource is missing or fails twice.
 */
export function useRunStream(pollMs = 3000): RunStreamState {
  const [state, setState] = useState<RunStreamState>({ runs: [], transport: "connecting", error: null, version: 0, lastEvent: null });
  const failures = useRef(0);

  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onEvent = (ev: RunStreamEvent) =>
      setState((s) =>
        ev.type === "error"
          ? { ...s, error: ev.message }
          : { ...s, runs: applyRunEvent(s.runs, ev), error: null, version: s.version + 1, lastEvent: ev },
      );

    const poll = async () => {
      if (stopped) return;
      try {
        const runs = await api.listRuns();
        if (!stopped) {
          setState((s) => {
            const changed = JSON.stringify(s.runs) !== JSON.stringify(runs);
            return { ...s, runs, transport: "polling", error: null, version: changed ? s.version + 1 : s.version, lastEvent: changed ? { type: "snapshot", runs } : s.lastEvent };
          });
        }
      } catch (e) {
        if (!stopped) setState((s) => ({ ...s, transport: "polling", error: (e as Error).message }));
      }
      if (!stopped) timer = setTimeout(poll, pollMs);
    };

    if (typeof EventSource === "undefined") {
      void poll();
    } else {
      es = new EventSource("/api/stream/runs");
      es.onopen = () => setState((s) => ({ ...s, transport: "sse" }));
      const handler = (m: MessageEvent<string>) => {
        failures.current = 0;
        onEvent(JSON.parse(m.data) as RunStreamEvent);
      };
      es.addEventListener("snapshot", handler);
      es.addEventListener("run", handler);
      es.addEventListener("error", (m) => {
        if (m instanceof MessageEvent && typeof m.data === "string") {
          handler(m as MessageEvent<string>);
          return;
        }
        failures.current += 1;
        if (failures.current >= 2 && es) {
          es.close();
          es = null;
          void poll();
        }
      });
    }
    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return state;
}
