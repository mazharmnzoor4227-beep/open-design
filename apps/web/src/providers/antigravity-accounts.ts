// Client for the Antigravity multi-account endpoints
// (`GET/POST /api/antigravity/accounts…`). Same store the
// `od antigravity accounts …` CLI drives; no tokens ever cross this
// boundary — only labels, ids, and quota flags. The in-app sign-in
// (daemon runs `agy` in a PTY, Axion-style) adds the auth endpoints:
// the UI shows the Google sign-in URL, the user pastes the one-time
// code back, and the daemon records the signed-in email.

import type {
  AntigravityAccount,
  AntigravityAccountsResponse,
  AntigravityAuthSession,
  AntigravityAuthSessionResponse,
  StartAntigravityAuthResponse,
} from '@open-design/contracts/api/antigravityAccounts';

/** How often the auth panel re-reads a live sign-in session. */
export const ANTIGRAVITY_AUTH_POLL_MS = 2000;

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as
      | { error?: { message?: string } | string; message?: string }
      | null;
    if (typeof payload?.error === 'string') return payload.error;
    return (
      payload?.error?.message ??
      payload?.message ??
      `Daemon responded with ${response.status}`
    );
  } catch {
    return `Daemon responded with ${response.status}`;
  }
}

export async function fetchAntigravityAccounts(): Promise<AntigravityAccountsResponse> {
  const response = await fetch('/api/antigravity/accounts');
  if (!response.ok) throw new Error(await readErrorDetail(response));
  return (await response.json()) as AntigravityAccountsResponse;
}

export async function createAntigravityAccount(
  label: string,
): Promise<AntigravityAccount> {
  const response = await fetch('/api/antigravity/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new Error(await readErrorDetail(response));
  const body = (await response.json()) as { account: AntigravityAccount };
  return body.account;
}

export async function activateAntigravityAccount(
  id: string,
): Promise<AntigravityAccount> {
  const response = await fetch(
    `/api/antigravity/accounts/${encodeURIComponent(id)}/activate`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  const body = (await response.json()) as { account: AntigravityAccount };
  return body.account;
}

export async function clearAntigravityAccountQuota(
  id: string,
): Promise<AntigravityAccount> {
  const response = await fetch(
    `/api/antigravity/accounts/${encodeURIComponent(id)}/clear-quota`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  const body = (await response.json()) as { account: AntigravityAccount };
  return body.account;
}

export async function removeAntigravityAccount(id: string): Promise<void> {
  const response = await fetch(
    `/api/antigravity/accounts/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
}

export async function startAntigravityAuth(
  id: string,
): Promise<AntigravityAuthSession> {
  const response = await fetch(
    `/api/antigravity/accounts/${encodeURIComponent(id)}/auth/start`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  const body = (await response.json()) as StartAntigravityAuthResponse;
  return body.session;
}

export async function fetchAntigravityAuth(
  id: string,
): Promise<AntigravityAuthSession> {
  const response = await fetch(
    `/api/antigravity/accounts/${encodeURIComponent(id)}/auth`,
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  const body = (await response.json()) as AntigravityAuthSessionResponse;
  return body.session;
}

export async function submitAntigravityAuthCode(
  id: string,
  code: string,
): Promise<AntigravityAuthSession> {
  const response = await fetch(
    `/api/antigravity/accounts/${encodeURIComponent(id)}/auth/code`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  const body = (await response.json()) as AntigravityAuthSessionResponse;
  return body.session;
}

export async function cancelAntigravityAuth(
  id: string,
): Promise<AntigravityAuthSession> {
  const response = await fetch(
    `/api/antigravity/accounts/${encodeURIComponent(id)}/auth/cancel`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(await readErrorDetail(response));
  const body = (await response.json()) as AntigravityAuthSessionResponse;
  return body.session;
}
