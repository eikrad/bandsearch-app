// Test doubles for fetch.
//
// Tests used to hand production code object literals like `{ ok, status, json }`.
// Those satisfy the few properties the code touches but are not a Response, so
// none of it type-checked and a double could drift from what fetch really
// returns. Building a real Response keeps the doubles honest and the types quiet.

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** A Response with a non-2xx status, for exercising error paths. */
export function errorResponse(status: number, body: unknown = {}): Response {
  return jsonResponse(body, { status });
}
