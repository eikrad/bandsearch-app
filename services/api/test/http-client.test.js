const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchWithTimeoutAndRetry } = require("../src/integrations/httpClient");

test("succeeds on first attempt and returns response", async () => {
  const mockResponse = { ok: true, status: 200 };
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
  const mockResponse = { ok: true, status: 200 };
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
    (err) => {
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
  const mockResponse = { ok: true, status: 200 };
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
