import { createLogger, silentLogger, type Logger } from "./logger.js";
import { scrub } from "./redact.js";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type HttpSuccess<T> = { ok: true; status: number; data: T };
export type HttpFailure = { ok: false; code: string; message: string; status?: number };
export type HttpResult<T> = HttpSuccess<T> | HttpFailure;

export type HttpClientOptions = {
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  logger?: Logger;
  secrets?: readonly string[];
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryAfterCapMs?: number;
  minIntervalMs?: number;
  maxResponseChars?: number;
  userAgent?: string;
};

export type HttpClient = {
  getJson(url: string, headers?: Record<string, string>): Promise<HttpResult<unknown>>;
  postJson(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResult<unknown>>;
};

const DEFAULT_USER_AGENT = "uk-public-research-agent/0.1";

export function retryAfterMs(
  header: string | null,
  now: number,
  capMs: number,
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.min(capMs, Math.max(0, Number(trimmed) * 1000));
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.min(capMs, Math.max(0, date - now));
}

export function backoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(exp * (0.5 + 0.5 * random()));
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const secrets = options.secrets ?? [];
  const logger =
    options.logger ??
    (secrets.length > 0 ? createLogger({ secrets, level: "warn" }) : silentLogger);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const retryAfterCapMs = options.retryAfterCapMs ?? 10_000;
  const minIntervalMs = options.minIntervalMs ?? 0;
  const maxResponseChars = options.maxResponseChars ?? 8_000_000;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  let nextAllowedAt = 0;

  async function pace(): Promise<void> {
    if (minIntervalMs <= 0) return;
    const current = now();
    const wait = Math.max(0, nextAllowedAt - current);
    nextAllowedAt = Math.max(nextAllowedAt, current) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  }

  async function send(
    url: string,
    method: "GET" | "POST",
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResult<unknown>> {
    await pace();
    let last: HttpFailure = { ok: false, code: "network", message: "Request failed." };
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await fetchFn(url, {
          method,
          headers: { accept: "application/json", "user-agent": userAgent, ...headers },
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const message = scrub(
          error instanceof Error ? error.message : "Network request failed.",
          secrets,
        );
        last = { ok: false, code: "network", message };
        logger.warn("request failed before a response", {
          code: "network",
          path: pathOf(url),
          attempt,
          message,
        });
        if (attempt >= maxRetries) return last;
        await sleep(backoffMs(attempt, baseDelayMs, maxDelayMs, random));
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        const delay = retryAfterMs(response.headers.get("retry-after"), now(), retryAfterCapMs);
        await discard(response);
        const code = response.status === 429 ? "rate_limited" : "upstream_unavailable";
        last = {
          ok: false,
          code,
          message: response.status === 429 ? "Rate limit exceeded." : "Upstream unavailable.",
          status: response.status,
        };
        logger.warn("upstream asked for a retry", {
          status: response.status,
          path: pathOf(url),
          attempt,
        });
        if (attempt >= maxRetries) return last;
        await sleep(delay ?? backoffMs(attempt, baseDelayMs, maxDelayMs, random));
        continue;
      }

      const text = await response.text();
      if (text.length > maxResponseChars) {
        return {
          ok: false,
          code: "invalid_response",
          message: "Response exceeded the size limit.",
          status: response.status,
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          code: "unauthorized",
          message: "Upstream rejected the credentials.",
          status: response.status,
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          code: "not_found",
          message: "Resource not found.",
          status: response.status,
        };
      }
      if (response.status >= 400) {
        return {
          ok: false,
          code: "bad_request",
          message: publicBody(text, secrets) || `Request failed with status ${response.status}.`,
          status: response.status,
        };
      }
      if (text.trim() === "") {
        return {
          ok: false,
          code: "invalid_response",
          message: "Empty response body.",
          status: response.status,
        };
      }
      try {
        return { ok: true, status: response.status, data: JSON.parse(text) as unknown };
      } catch {
        return {
          ok: false,
          code: "invalid_response",
          message: "Response was not JSON.",
          status: response.status,
        };
      }
    }
    return last;
  }

  return {
    getJson: (url, headers = {}) => send(url, "GET", headers),
    postJson: (url, body, headers = {}) =>
      send(url, "POST", { "content-type": "application/json", ...headers }, JSON.stringify(body)),
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "invalid-url";
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is unused on the retry path.
  }
}

function publicBody(text: string, secrets: readonly string[]): string {
  const snippet = messageFromBody(text).slice(0, 200);
  return scrub(snippet, secrets);
}

function messageFromBody(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.message === "string") return record.message;
      if (typeof record.error === "string") return record.error;
      if (
        Array.isArray(record.errors) &&
        record.errors[0] &&
        typeof record.errors[0] === "object"
      ) {
        const first = record.errors[0] as Record<string, unknown>;
        if (typeof first.error === "string") return first.error;
      }
    }
  } catch {
    return text;
  }
  return text;
}
