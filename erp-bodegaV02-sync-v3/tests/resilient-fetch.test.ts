import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchWithRetry,
  RequestTimeoutError,
  type FetchFunction,
} from "../lib/resilient-fetch.ts";

test("libera una solicitud que no responde y limita los reintentos", async () => {
  let attempts = 0;
  const hangingFetch: FetchFunction = (_input, init) => {
    attempts += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Abortada", "AbortError")),
        { once: true },
      );
    });
  };

  await assert.rejects(
    fetchWithRetry("/api/program", undefined, {
      timeoutMs: 10,
      retryDelayMs: 1,
      maxRetries: 1,
      fetcher: hangingFetch,
    }),
    RequestTimeoutError,
  );
  assert.equal(attempts, 2);
});

test("reintenta una respuesta temporal 503 y devuelve la siguiente válida", async () => {
  let attempts = 0;
  const temporaryFailure: FetchFunction = async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("ocupado", { status: 503 })
      : Response.json({ ok: true });
  };

  const response = await fetchWithRetry("/api/program", undefined, {
    timeoutMs: 100,
    retryDelayMs: 1,
    maxRetries: 1,
    fetcher: temporaryFailure,
  });

  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
});

test("no repite una respuesta correcta", async () => {
  let attempts = 0;
  const successfulFetch: FetchFunction = async () => {
    attempts += 1;
    return Response.json({ ok: true });
  };

  const response = await fetchWithRetry("/api/program", undefined, {
    timeoutMs: 100,
    maxRetries: 1,
    fetcher: successfulFetch,
  });

  assert.equal(response.status, 200);
  assert.equal(attempts, 1);
});
