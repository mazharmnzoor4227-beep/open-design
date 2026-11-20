// Client for the Antigravity multi-account endpoints
// (`GET/POST /api/antigravity/accounts…`). Same store the
// `od antigravity accounts …` CLI drives; no tokens ever cross this
// boundary — only labels, ids, and quota flags.

import type {
  AntigravityAccount,
  AntigravityAccountsResponse,
} from '@open-design/contracts/api/antigravityAccounts';

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
