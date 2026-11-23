export interface ApiClientSession {
  cookieHeader: string;
  csrfToken: string;
}

/** Extract cookies from response headers */
export function extractCookiesFromHeaders(headers: Headers): Record<string, string> {
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const rawList = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : [];
  const cookies: Record<string, string> = {};
  for (const raw of rawList) {
    const firstSegment = raw.split(';')[0] ?? '';
    const eqIndex = firstSegment.indexOf('=');
    if (eqIndex > 0) {
      const name = firstSegment.slice(0, eqIndex).trim();
      const val = firstSegment.slice(eqIndex + 1).trim();
      cookies[name] = val;
    }
  }
  return cookies;
}

/** Simple API fetch wrapper respecting session cookie and CSRF token */
export async function apiFetch(
  baseUrl: string,
  routePath: string,
  options?: {
    method?: string;
    body?: unknown;
    session?: ApiClientSession;
    omitCsrf?: boolean;
    extraHeaders?: Record<string, string>;
  },
): Promise<{
  status: number;
  statusText: string;
  redirected: boolean;
  finalUrl: string;
  headers: Headers;
  contentType: string;
  bodyText: string;
  json: Record<string, any> | null;
}> {
  const headers: Record<string, string> = {
    ...(options?.extraHeaders ?? {}),
  };
  if (options?.session?.cookieHeader) {
    headers.cookie = options.session.cookieHeader;
  }
  if (options?.session?.csrfToken && !options?.omitCsrf) {
    headers['x-csrf-token'] = options.session.csrfToken;
  }
  let bodyStr: string | undefined;
  if (options?.body !== undefined) {
    headers['content-type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  const res = await fetch(`${baseUrl}${routePath}`, {
    method: options?.method ?? 'GET',
    headers,
    body: bodyStr,
  });

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const bodyText = buffer.toString('utf8');
  const contentType = res.headers.get('content-type') ?? '';
  let json: Record<string, any> | null = null;
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(bodyText) as Record<string, any>;
    } catch {
      json = null;
    }
  }

  return {
    status: res.status,
    statusText: res.statusText,
    redirected: res.redirected,
    finalUrl: res.url,
    headers: res.headers,
    contentType,
    bodyText,
    json,
  };
}

/** Authenticate a user and extract the session cookie & CSRF token */
export async function loginAs(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{
  status: number;
  json: Record<string, any> | null;
  session: ApiClientSession;
  rawSetCookies: string[];
}> {
  const res = await apiFetch(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const rawSetCookies = typeof getSetCookie === 'function' ? getSetCookie.call(res.headers) : [];
  const parsed = extractCookiesFromHeaders(res.headers);
  const cookieHeader = Object.entries(parsed)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const csrfToken = String(res.json?.data?.csrfToken ?? parsed.ct_rss_csrf ?? '');
  return {
    status: res.status,
    json: res.json,
    session: { cookieHeader, csrfToken },
    rawSetCookies,
  };
}
