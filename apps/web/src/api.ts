import type { ReportView } from '@jaanch/core';
import type { Lang } from './i18n';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok) {
    let code = res.status === 429 ? 'rate_limited' : res.status === 404 ? 'not_found' : 'error';
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      code = body.error?.code ?? code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export interface Meta {
  whatsapp: {
    enabled: boolean;
    number: string | null;
    joinCode: string | null;
    link: string | null;
    sandbox: boolean;
    /** Meta's free test number: only numbers registered by the team can use it. */
    testNumber?: boolean;
  };
  limits: { maxImages: number; maxUploadMb: number };
  reportTtlDays: number;
  readerAvailable: boolean;
  audioSupported: boolean;
  fixtureMode: boolean;
}

export interface SourcesStatus {
  sebi: {
    liveLookups: boolean;
    categories: Array<{
      category: string;
      asOf: string | null;
      retrievedAt: string | null;
      records: number;
      isFixture: boolean;
    }>;
  };
  rbiAlertList: { asOf: string | null; entries: number; isFixture: boolean };
  rdap: { enabled: boolean };
  rules: { verifiedOn: string };
  fixtureMode: boolean;
}

export interface Created {
  id: string;
  ownerToken: string | null;
  expiresAt: string;
}

export interface Status {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string | null;
  createdAt: string;
  expiresAt: string;
  view: ReportView | null;
  error: { code: string } | null;
}

export interface Recovery {
  title: string;
  steps: Array<{ id: string; text: string; href: string | null; phone: string | null }>;
  summary: string;
}

export const api = {
  meta: () => call<Meta>('/api/v1/meta'),
  sources: () => call<SourcesStatus>('/api/v1/sources'),
  create: (form: FormData) =>
    call<Created>('/api/v1/investigations', { method: 'POST', body: form }),
  status: (id: string, lang: Lang) =>
    call<Status>(`/api/v1/investigations/${encodeURIComponent(id)}?locale=${lang}`),
  summary: (id: string, lang: Lang) =>
    call<string>(`/api/v1/investigations/${encodeURIComponent(id)}/summary?locale=${lang}`),
  recovery: (id: string, lang: Lang) =>
    call<Recovery>(`/api/v1/investigations/${encodeURIComponent(id)}/recovery?locale=${lang}`),
  remove: (id: string, token: string) =>
    call<void>(`/api/v1/investigations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),
};

const TOKENS_KEY = 'jaanch.ownerTokens';

/** Owner tokens let the person who ran a check delete it; kept only in this browser. */
export function rememberToken(id: string, token: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as Record<string, string>;
    all[id] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: delete button simply won't show */
  }
}

export function tokenFor(id: string): string | null {
  try {
    return (
      (JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as Record<string, string>)[id] ?? null
    );
  } catch {
    return null;
  }
}

export function forgetToken(id: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as Record<string, string>;
    delete all[id];
    localStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
