// Antigravity multi-account store.
//
// Stock `agy` holds exactly one Google login at a time, so the fork keeps
// each connected Antigravity account in its own credential home under the
// daemon data root:
//
//   <RUNTIME_DATA_DIR>/antigravity-accounts/accounts.json   (the registry)
//   <RUNTIME_DATA_DIR>/antigravity-accounts/ag-xxxxxxxx/    (one HOME per account)
//
// A run spawns agy with `HOME` pointed at the active account's home, so
// agy reads that account's OAuth credentials and its
// `.gemini/antigravity-cli/settings.json`. No tokens are stored here —
// credentials live in agy's own files inside the account home, exactly as
// stock agy stores them. The registry only records labels, the active
// pointer, and quota flags.
//
// Quota rotation (honest scope): when a run fails with `RATE_LIMITED`
// (read from agy's `--log-file`, the only place it surfaces), the daemon
// flags that account quota-exhausted for 24h and the next run resolves to
// the next usable account, moving the active pointer. Rotation happens
// BETWEEN runs — a run that already hit quota is not retried mid-run.
// Quota is per-model upstream, so the account-level flag is conservative:
// an account flagged for one model may still have quota on another. The
// flag auto-expires after 24h and can be cleared by hand.

import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { AntigravityAccount } from '@open-design/contracts/api/antigravityAccounts';

export const ANTIGRAVITY_ACCOUNTS_DIR_NAME = 'antigravity-accounts';

/** `ag-` + 8 lowercase hex chars. The id is also a directory name, so it
 *  must never contain a separator — validate before joining any path. */
const ACCOUNT_ID_PATTERN = /^ag-[0-9a-f]{8}$/;

/** How long a quota-exhausted flag lasts before the account is usable
 *  again. Antigravity quotas reset on Google's schedule (daily/weekly);
 *  24h is a conservative default the user can clear by hand sooner. */
export const ANTIGRAVITY_QUOTA_FLAG_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_LABEL_LENGTH = 64;

interface AntigravityAccountRecord {
  id: string;
  label: string;
  createdAt: string;
  quotaExhaustedUntil: string | null;
}

interface AntigravityAccountStore {
  version: 1;
  activeAccountId: string | null;
  accounts: AntigravityAccountRecord[];
}

export function antigravityAccountsRoot(dataDir: string): string {
  return join(dataDir, ANTIGRAVITY_ACCOUNTS_DIR_NAME);
}

export function antigravityAccountsFile(dataDir: string): string {
  return join(antigravityAccountsRoot(dataDir), 'accounts.json');
}

export function isValidAntigravityAccountId(accountId: string): boolean {
  return ACCOUNT_ID_PATTERN.test(accountId);
}

export function antigravityAccountHomeDir(
  dataDir: string,
  accountId: string,
): string {
  if (!isValidAntigravityAccountId(accountId)) {
    throw new Error(`Invalid Antigravity account id: ${accountId}`);
  }
  return join(antigravityAccountsRoot(dataDir), accountId);
}

export function antigravityAccountSettingsPath(
  dataDir: string,
  accountId: string,
): string {
  return join(
    antigravityAccountHomeDir(dataDir, accountId),
    '.gemini',
    'antigravity-cli',
    'settings.json',
  );
}

function emptyStore(): AntigravityAccountStore {
  return { version: 1, activeAccountId: null, accounts: [] };
}

function isRecord(value: unknown): value is AntigravityAccountRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    ACCOUNT_ID_PATTERN.test(record.id) &&
    typeof record.label === 'string' &&
    typeof record.createdAt === 'string' &&
    (record.quotaExhaustedUntil === null ||
      typeof record.quotaExhaustedUntil === 'string')
  );
}

function readAntigravityAccountStore(
  dataDir: string,
): AntigravityAccountStore {
  const file = antigravityAccountsFile(dataDir);
  if (!existsSync(file)) return emptyStore();
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('store is not an object');
    }
    const raw = parsed as Record<string, unknown>;
    const accounts = Array.isArray(raw.accounts)
      ? raw.accounts.filter(isRecord)
      : [];
    const activeAccountId =
      typeof raw.activeAccountId === 'string' &&
      accounts.some((account) => account.id === raw.activeAccountId)
        ? (raw.activeAccountId as string)
        : (accounts[0]?.id ?? null);
    return { version: 1, activeAccountId, accounts };
  } catch (err) {
    // A corrupt registry must never block runs or the Settings page: fall
    // back to "no accounts" (stock single-login behaviour) and let the
    // next write repair the file. The credential homes themselves are
    // untouched, so no login is lost — only the registry entry.
    console.warn(
      `[antigravity-accounts] ignoring corrupt registry at ${file}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return emptyStore();
  }
}

function writeAntigravityAccountStore(
  dataDir: string,
  store: AntigravityAccountStore,
): void {
  const root = antigravityAccountsRoot(dataDir);
  mkdirSync(root, { recursive: true });
  const file = antigravityAccountsFile(dataDir);
  const tempFile = `${file}.tmp-${process.pid}`;
  writeFileSync(tempFile, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tempFile, file);
}

export function isAntigravityAccountQuotaExhausted(
  record: Pick<AntigravityAccountRecord, 'quotaExhaustedUntil'>,
  nowMs: number = Date.now(),
): boolean {
  if (!record.quotaExhaustedUntil) return false;
  const until = Date.parse(record.quotaExhaustedUntil);
  if (Number.isNaN(until)) return false;
  return until > nowMs;
}

function toPublicAccount(
  dataDir: string,
  record: AntigravityAccountRecord,
  activeAccountId: string | null,
  nowMs: number,
): AntigravityAccount {
  return {
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    active: record.id === activeAccountId,
    quotaExhausted: isAntigravityAccountQuotaExhausted(record, nowMs),
    quotaExhaustedUntil: record.quotaExhaustedUntil,
    homeDir: antigravityAccountHomeDir(dataDir, record.id),
  };
}

export function listAntigravityAccounts(
  dataDir: string,
  nowMs: number = Date.now(),
): AntigravityAccount[] {
  const store = readAntigravityAccountStore(dataDir);
  return store.accounts.map((record) =>
    toPublicAccount(dataDir, record, store.activeAccountId, nowMs),
  );
}

export function createAntigravityAccount(
  dataDir: string,
  label: string,
  nowMs: number = Date.now(),
): AntigravityAccount {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Antigravity account label is required');
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new Error(
      `Antigravity account label must be at most ${MAX_LABEL_LENGTH} characters`,
    );
  }
  const store = readAntigravityAccountStore(dataDir);
  const record: AntigravityAccountRecord = {
    id: `ag-${randomBytes(4).toString('hex')}`,
    label: trimmed,
    createdAt: new Date(nowMs).toISOString(),
    quotaExhaustedUntil: null,
  };
  store.accounts.push(record);
  if (!store.activeAccountId) store.activeAccountId = record.id;
  mkdirSync(antigravityAccountHomeDir(dataDir, record.id), {
    recursive: true,
  });
  writeAntigravityAccountStore(dataDir, store);
  return toPublicAccount(dataDir, record, store.activeAccountId, nowMs);
}

export function setActiveAntigravityAccount(
  dataDir: string,
  accountId: string,
  nowMs: number = Date.now(),
): AntigravityAccount | null {
  if (!isValidAntigravityAccountId(accountId)) return null;
  const store = readAntigravityAccountStore(dataDir);
  const record = store.accounts.find((candidate) => candidate.id === accountId);
  if (!record) return null;
  store.activeAccountId = record.id;
  writeAntigravityAccountStore(dataDir, store);
  return toPublicAccount(dataDir, record, store.activeAccountId, nowMs);
}

export function removeAntigravityAccount(
  dataDir: string,
  accountId: string,
): boolean {
  if (!isValidAntigravityAccountId(accountId)) return false;
  const store = readAntigravityAccountStore(dataDir);
  const index = store.accounts.findIndex(
    (candidate) => candidate.id === accountId,
  );
  if (index < 0) return false;
  store.accounts.splice(index, 1);
  if (store.activeAccountId === accountId) {
    store.activeAccountId = store.accounts[0]?.id ?? null;
  }
  // The credential home holds that account's agy OAuth login — removing
  // the account removes its login too. Scoped to the validated id so a
  // bad id can never delete outside the accounts root.
  rmSync(antigravityAccountHomeDir(dataDir, accountId), {
    recursive: true,
    force: true,
  });
  writeAntigravityAccountStore(dataDir, store);
  return true;
}

export function clearAntigravityAccountQuota(
  dataDir: string,
  accountId: string,
  nowMs: number = Date.now(),
): AntigravityAccount | null {
  if (!isValidAntigravityAccountId(accountId)) return null;
  const store = readAntigravityAccountStore(dataDir);
  const record = store.accounts.find((candidate) => candidate.id === accountId);
  if (!record) return null;
  record.quotaExhaustedUntil = null;
  writeAntigravityAccountStore(dataDir, store);
  return toPublicAccount(dataDir, record, store.activeAccountId, nowMs);
}

export function markAntigravityAccountQuotaExhausted(
  dataDir: string,
  accountId: string,
  nowMs: number = Date.now(),
): AntigravityAccount | null {
  if (!isValidAntigravityAccountId(accountId)) return null;
  const store = readAntigravityAccountStore(dataDir);
  const record = store.accounts.find((candidate) => candidate.id === accountId);
  if (!record) return null;
  record.quotaExhaustedUntil = new Date(
    nowMs + ANTIGRAVITY_QUOTA_FLAG_TTL_MS,
  ).toISOString();
  writeAntigravityAccountStore(dataDir, store);
  return toPublicAccount(dataDir, record, store.activeAccountId, nowMs);
}

/**
 * Resolve the account a run should use. No accounts configured → null,
 * and the caller falls back to stock behaviour (daemon HOME, default
 * settings path). Active account usable → it. Active account
 * quota-flagged → the next usable account in creation order, and the
 * active pointer moves there so the UI and the next run agree. Every
 * account flagged → the active account (a truthful quota failure on the
 * next run beats silently running under an unrelated login).
 */
export function resolveAntigravityAccountForRun(
  dataDir: string,
  nowMs: number = Date.now(),
): AntigravityAccount | null {
  const store = readAntigravityAccountStore(dataDir);
  if (store.accounts.length === 0) return null;
  const usable = (record: AntigravityAccountRecord): boolean =>
    !isAntigravityAccountQuotaExhausted(record, nowMs);
  const active = store.accounts.find(
    (candidate) => candidate.id === store.activeAccountId,
  );
  if (active && usable(active)) {
    return toPublicAccount(dataDir, active, store.activeAccountId, nowMs);
  }
  const next = store.accounts.find(usable);
  if (next) {
    store.activeAccountId = next.id;
    writeAntigravityAccountStore(dataDir, store);
    return toPublicAccount(dataDir, next, store.activeAccountId, nowMs);
  }
  if (active) {
    return toPublicAccount(dataDir, active, store.activeAccountId, nowMs);
  }
  return toPublicAccount(
    dataDir,
    store.accounts[0]!,
    store.activeAccountId,
    nowMs,
  );
}
