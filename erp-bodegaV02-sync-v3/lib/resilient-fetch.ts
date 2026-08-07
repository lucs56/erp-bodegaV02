export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ResilientFetchOptions = {
  timeoutMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  retryStatuses?: readonly number[];
  fetcher?: FetchFunction;
};

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`La solicitud superó el tiempo máximo de ${timeoutMs} ms.`);
    this.name = "RequestTimeoutError";
  }
}

const DEFAULT_RETRY_STATUSES = [429, 503, 504] as const;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

async function fetchAttempt(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fetcher: FetchFunction,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Ejecuta una consulta con tiempo máximo y reintentos acotados.
 *
 * Evita que una respuesta pendiente de Google o Cloudflare mantenga la
 * interfaz indefinidamente en "Actualizando…". Una señal de cancelación
 * enviada por el llamador siempre tiene prioridad y no se reintenta.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ResilientFetchOptions = {},
) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 12_000);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 800);
  const maxRetries = Math.max(0, options.maxRetries ?? 1);
  const retryStatuses =
    options.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const fetcher: FetchFunction =
    options.fetcher ?? ((request, requestInit) => fetch(request, requestInit));

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchAttempt(
        input,
        init,
        fetcher,
        timeoutMs,
      );
      if (
        attempt < maxRetries &&
        retryStatuses.includes(response.status)
      ) {
        await wait(retryDelayMs);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (init?.signal?.aborted || attempt >= maxRetries) throw error;
      await wait(retryDelayMs);
    }
  }

  throw lastError;
}
