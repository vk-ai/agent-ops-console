These JSON files are real responses from agent-runtime-gcp (in-memory persistence,
mock providers), captured with curl on 2026-10-09 and re-captured on 2026-10-11 from the
edit-args approvals branch (vk-ai/agent-runtime-gcp#1), which adds `args`, `pending_decision` and
the extra `approval` fields:

- `run-waiting.json`: `POST /runs` with a risky task (pauses at `human_approval`)
- `run-approved.json` / `run-rejected.json`: `POST /runs/{id}/decision`
- `run-edited.json` / `decisions-run-edited.json`: `{decision: "edit", pending_id, args_digest, edited_args}`, then `GET /runs/{id}/decisions`
- `run-plain.json`: `POST /runs` with no risky action
- `run-failed.json`: `POST /runs` with `AGENTRT_FAIL_PROVIDERS=mock-primary=error,mock-backup=error`
- `memories-*.json`: `GET /users/{id}/memories`; `runs-list.json`: `GET /runs`

The unit tests use them to check the timeline logic and that the console's
mock runtime produces the same shapes and values.
