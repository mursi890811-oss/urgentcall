const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

let _token: string | null = null;
export function setAuthToken(t: string | null) { _token = t; }

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries only network-level failures (no response at all) - e.g. a flaky/weak connection
 * dropping the request before it reaches the server. A real HTTP error response (4xx/5xx)
 * means the server was reached and responded, so retrying blindly would be wrong (e.g. you
 * don't want to silently retry a failed login 3 times). */
async function requestWithRetry<T>(method: string, path: string, body?: any, attempt = 1): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch() throws only on actual network failure (no connectivity, DNS failure,
    // request dropped mid-flight) - never on a valid HTTP error response.
    const MAX_ATTEMPTS = 3;
    if (attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 800); // 800ms, then 1600ms
      return requestWithRetry<T>(method, path, body, attempt + 1);
    }
    throw new Error("Network request failed - check your connection and try again.");
  }

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => requestWithRetry<T>("GET", path),
  post: <T>(path: string, body?: any) => requestWithRetry<T>("POST", path, body),
  patch: <T>(path: string, body?: any) => requestWithRetry<T>("PATCH", path, body),
  delete: <T>(path: string) => requestWithRetry<T>("DELETE", path),
};
