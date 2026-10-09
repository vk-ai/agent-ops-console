export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`upstream ${status}: ${detail}`);
  }
}

/** FastAPI errors look like {"detail": "..."}; keep that shape through the BFF. */
export function errorResponse(e: unknown): Response {
  if (e instanceof UpstreamError) return Response.json({ detail: e.detail }, { status: e.status });
  const msg = e instanceof Error ? e.message : String(e);
  return Response.json({ detail: msg }, { status: 502 });
}
