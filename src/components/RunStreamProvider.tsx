"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useRunStream, type RunStreamState } from "@/lib/use-run-stream";

const Ctx = createContext<RunStreamState | null>(null);

/** One shared live connection for the whole console. */
export function RunStreamProvider({ children, pollMs }: { children: ReactNode; pollMs?: number }) {
  const state = useRunStream(pollMs);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useRuns(): RunStreamState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRuns must be used inside <RunStreamProvider>");
  return v;
}

/** For tests: provide a fixed state without any network. */
export function StaticRuns({ value, children }: { value: RunStreamState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
