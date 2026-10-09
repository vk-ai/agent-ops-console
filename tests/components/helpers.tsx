import { render } from "@testing-library/react";
import { setupServer } from "msw/node";
import type { ReactElement } from "react";
import { StaticRuns } from "@/components/RunStreamProvider";
import type { RunStreamState } from "@/lib/use-run-stream";
import { createMockApi, handlers, type MockApi } from "@/mocks/handlers";

export async function mockServer(): Promise<{ api: MockApi; server: ReturnType<typeof setupServer> }> {
  const api = createMockApi();
  await api.runtime.seed();
  const server = setupServer(...handlers(api));
  return { api, server };
}

export async function renderWithRuns(ui: ReactElement, api: MockApi, extra: Partial<RunStreamState> = {}) {
  const runs = await api.runtime.listRuns();
  const value: RunStreamState = { runs, transport: "sse", error: null, version: 1, lastEvent: null, ...extra };
  const utils = render(<StaticRuns value={value}>{ui}</StaticRuns>);
  return {
    ...utils,
    /** Simulate the live stream delivering a fresh list. */
    async push() {
      const next = await api.runtime.listRuns();
      value.version += 1;
      utils.rerender(<StaticRuns value={{ ...value, runs: next }}>{ui}</StaticRuns>);
    },
  };
}
