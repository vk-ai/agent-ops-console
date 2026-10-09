#!/usr/bin/env bash
# Start agent-runtime-gcp and mcp-integration-hub locally and run the live
# integration tests against them.
#
#   RUNTIME_PY=/path/to/venv/bin/python HUB_PY=/path/to/venv/bin/python scripts/integration.sh
#
# Each python must have the respective package installed, e.g.
#   pip install "agent-runtime-gcp @ git+https://github.com/vk-ai/agent-runtime-gcp"
#   pip install "mcp-integration-hub @ git+https://github.com/vk-ai/mcp-integration-hub"
set -euo pipefail
RUNTIME_PY=${RUNTIME_PY:-python}
HUB_PY=${HUB_PY:-python}
RT_PORT=${RT_PORT:-8100}; SB_PORT=${SB_PORT:-9000}; HUB_PORT=${HUB_PORT:-8200}
LOG=${LOG_DIR:-$(mktemp -d)}; mkdir -p "$LOG"
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

AGENTRT_PERSISTENCE=memory AGENTRT_APPROVER_TOKEN=dev-approver \
  "$RUNTIME_PY" -m uvicorn agent_runtime.api:create_app --factory --port "$RT_PORT" >"$LOG/runtime.log" 2>&1 & pids+=($!)
"$HUB_PY" -m mcp_hub.cli sandbox --port "$SB_PORT" >"$LOG/sandbox.log" 2>&1 & pids+=($!)
MCP_HUB_PUBLIC_URL="http://127.0.0.1:$HUB_PORT" MCP_HUB_SANDBOX_URL="http://127.0.0.1:$SB_PORT" \
  MCP_HUB_AUDIT_PATH="$LOG/audit.jsonl" \
  "$HUB_PY" -m mcp_hub.cli serve --port "$HUB_PORT" >"$LOG/hub.log" 2>&1 & pids+=($!)

for url in "http://127.0.0.1:$RT_PORT/healthz" "http://127.0.0.1:$HUB_PORT/healthz"; do
  for _ in $(seq 1 60); do curl -fsS "$url" >/dev/null 2>&1 && break; sleep 0.5; done
  curl -fsS "$url" >/dev/null || { echo "not up: $url"; tail -n 50 "$LOG"/*.log; exit 1; }
done

AGENT_RUNTIME_URL="http://127.0.0.1:$RT_PORT" AGENT_RUNTIME_APPROVER_TOKEN=dev-approver \
MCP_HUB_URL="http://127.0.0.1:$HUB_PORT" \
  npx vitest run --project integration
