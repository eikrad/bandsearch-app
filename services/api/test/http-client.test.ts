import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeoutAndRetry } from "../src/integrations/httpClient.js";

test("succeeds on first attempt and returns response", async () => {
  const mockResponse = new Response(null, { status: 200 });
  const fetchImpl = async () => mockResponse;

  const result = await fetchWithTimeoutAndRetry({
    fetchImpl,
    url: "https://example.com",
    timeoutMs: 1000,
    retries: 0,
    headers: {},
  });

  assert.equal(result, mockResponse);
});

test("retries on failure and succeeds on second attempt", async () => {
  let callCount = 0;
  const mockResponse = new Response(null, { status: 200 });
  const fetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) {
      throw new Error("network error");
    }
    return mockResponse;
  };

  const result = await fetchWithTimeoutAndRetry({
    fetchImpl,
    url: "https://example.com",
    timeoutMs: 1000,
    retries: 1,
    headers: {},
  });

  assert.equal(result, mockResponse);
  assert.equal(callCount, 2);
});

test("throws after exhausting all retries when retries=0", async () => {
  const fetchImpl = async () => {
    throw new Error("always fails");
  };

  await assert.rejects(
    () =>
      fetchWithTimeoutAndRetry({
        fetchImpl,
        url: "https://example.com",
        timeoutMs: 1000,
        retries: 0,
        headers: {},
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "always fails");
      return true;
    }
  );
});

test("calls fetchImpl retries+1 times on full failure", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    throw new Error("always fails");
  };

  await assert.rejects(() =>
    fetchWithTimeoutAndRetry({
      fetchImpl,
      url: "https://example.com",
      timeoutMs: 1000,
      retries: 3,
      headers: {},
    })
  );

  assert.equal(callCount, 4);
});

test("returns response when fetch succeeds (no dangling timer)", async () => {
  const mockResponse = new Response(null, { status: 200 });
  const fetchImpl = async () => mockResponse;

  const result = await fetchWithTimeoutAndRetry({
    fetchImpl,
    url: "https://example.com",
    timeoutMs: 5000,
    retries: 0,
    headers: { "x-test": "value" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});
