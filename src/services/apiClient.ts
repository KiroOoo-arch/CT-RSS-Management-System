interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  requestId?: string;
}

interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId?: string;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiClientError';
  }
}

let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ct_rss_csrf='));
  if (!match) {
    return null;
  }
  return decodeURIComponent(match.slice('ct_rss_csrf='.length));
}

function getActiveCsrfToken(): string | null {
  return inMemoryCsrfToken ?? readCsrfCookie();
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  let parsed: ApiSuccessEnvelope<T> | ApiErrorEnvelope | null = null;
  try {
    parsed = (await response.json()) as ApiSuccessEnvelope<T> | ApiErrorEnvelope;
  } catch {
    throw new ApiClientError(
      response.status,
      'INVALID_RESPONSE',
      `Server returned an unreadable response (${response.status}).`,
    );
  }

  if (!response.ok || !parsed || !parsed.success) {
    const errorCode = parsed && !parsed.success ? parsed.error.code : 'REQUEST_FAILED';
    const errorMessage =
      parsed && !parsed.success
        ? parsed.error.message
        : `Request failed with status ${response.status}.`;
    throw new ApiClientError(response.status, errorCode, errorMessage);
  }

  return parsed.data;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  return parseJsonResponse<T>(response);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const csrf = getActiveCsrfToken();
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  return parseJsonResponse<T>(response);
}

export async function apiPatch<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const csrf = getActiveCsrfToken();
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  const response = await fetch(path, {
    method: 'PATCH',
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  return parseJsonResponse<T>(response);
}
