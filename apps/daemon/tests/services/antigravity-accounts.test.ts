import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANTIGRAVITY_QUOTA_FLAG_TTL_MS,
  antigravityAccountHomeDir,
  antigravityAccountSettingsPath,
  clearAntigravityAccountQuota,
  createAntigravityAccount,
  isValidAntigravityAccountId,
  listAntigravityAccounts,
  markAntigravityAccountQuotaExhausted,
  removeAntigravityAccount,
  resolveAntigravityAccountForRun,
  setActiveAntigravityAccount,
} from '../../src/services/antigravity-accounts.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'od-agy-accounts-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('antigravity accounts store', () => {
  it('starts empty and resolves to no account (stock single-login fallback)', () => {
    expect(listAntigravityAccounts(dataDir)).toEqual([]);
    expect(resolveAntigravityAccountForRun(dataDir)).toBeNull();
  });

  it('creates accounts with stable ids, own homes, and first-is-active', () => {
    const first = createAntigravityAccount(dataDir, 'Account 1');
    expect(first.id).toMatch(/^ag-[0-9a-f]{8}$/);
    expect(first.label).toBe('Account 1');
    expect(first.active).toBe(true);
    expect(first.quotaExhausted).toBe(false);
    expect(first.homeDir).toBe(
      antigravityAccountHomeDir(dataDir, first.id),
    );
    expect(antigravityAccountSettingsPath(dataDir, first.id)).toBe(
      join(first.homeDir, '.gemini', 'antigravity-cli', 'settings.json'),
    );

    const second = createAntigravityAccount(dataDir, 'Account 2');
    expect(second.active).toBe(false);
    expect(second.homeDir).not.toBe(first.homeDir);
    expect(listAntigravityAccounts(dataDir).map((a) => a.label)).toEqual([
      'Account 1',
      'Account 2',
    ]);
  });

  it('rejects blank and over-long labels', () => {
    expect(() => createAntigravityAccount(dataDir, '   ')).toThrow(
      /label is required/,
    );
    expect(() => createAntigravityAccount(dataDir, 'x'.repeat(65))).toThrow(
      /at most 64/,
    );
  });

  it('switches the active account without re-login', () => {
    const first = createAntigravityAccount(dataDir, 'Account 1');
    const second = createAntigravityAccount(dataDir, 'Account 2');
    const activated = setActiveAntigravityAccount(dataDir, second.id);
    expect(activated?.id).toBe(second.id);
    expect(activated?.active).toBe(true);
    const accounts = listAntigravityAccounts(dataDir);
    expect(accounts.find((a) => a.id === first.id)?.active).toBe(false);
    expect(setActiveAntigravityAccount(dataDir, 'ag-ffffffff')).toBeNull();
    expect(setActiveAntigravityAccount(dataDir, '../../etc')).toBeNull();
  });

  it('removes an account, its login home, and re-points active', () => {
    const first = createAntigravityAccount(dataDir, 'Account 1');
    const second = createAntigravityAccount(dataDir, 'Account 2');
    expect(removeAntigravityAccount(dataDir, first.id)).toBe(true);
    expect(listAntigravityAccounts(dataDir).map((a) => a.id)).toEqual([
      second.id,
    ]);
    // Active was the removed account — it moves to the survivor.
    expect(listAntigravityAccounts(dataDir)[0]?.active).toBe(true);
    expect(removeAntigravityAccount(dataDir, first.id)).toBe(false);
    expect(removeAntigravityAccount(dataDir, '../escape')).toBe(false);
  });

  it('rotates to the next usable account when the active one is quota-flagged', () => {
    const first = createAntigravityAccount(dataDir, 'Account 1');
    const second = createAntigravityAccount(dataDir, 'Account 2');
    createAntigravityAccount(dataDir, 'Account 3');
    const now = Date.now();

    markAntigravityAccountQuotaExhausted(dataDir, first.id, now);
    const resolved = resolveAntigravityAccountForRun(dataDir, now);
    expect(resolved?.id).toBe(second.id);
    // The pointer moved: a second resolution agrees, and the list shows
    // the flag on the first account.
    expect(resolveAntigravityAccountForRun(dataDir, now)?.id).toBe(second.id);
    const flagged = listAntigravityAccounts(dataDir, now).find(
      (a) => a.id === first.id,
    );
    expect(flagged?.quotaExhausted).toBe(true);
    expect(flagged?.quotaExhaustedUntil).toBe(
      new Date(now + ANTIGRAVITY_QUOTA_FLAG_TTL_MS).toISOString(),
    );
  });

  it('falls back to the flagged active account when every account is exhausted', () => {
    const first = createAntigravityAccount(dataDir, 'Account 1');
    createAntigravityAccount(dataDir, 'Account 2');
    const now = Date.now();
    markAntigravityAccountQuotaExhausted(dataDir, first.id, now);
    // Resolve moves active to Account 2; flag that one too.
    resolveAntigravityAccountForRun(dataDir, now);
    const accounts = listAntigravityAccounts(dataDir, now);
    const active = accounts.find((a) => a.active)!;
    markAntigravityAccountQuotaExhausted(dataDir, active.id, now);
    const resolved = resolveAntigravityAccountForRun(dataDir, now);
    expect(resolved?.id).toBe(active.id);
    expect(resolved?.quotaExhausted).toBe(true);
  });

  it('auto-expires the quota flag after the TTL and can clear it by hand', () => {
    const first = createAntigravityAccount(dataDir, 'Account 1');
    const second = createAntigravityAccount(dataDir, 'Account 2');
    const now = Date.now();
    markAntigravityAccountQuotaExhausted(dataDir, first.id, now);
    expect(
      resolveAntigravityAccountForRun(dataDir, now)?.id,
    ).toBe(second.id);
    // Past the TTL the flag is dead: the first account is usable again.
    expect(
      resolveAntigravityAccountForRun(
        dataDir,
        now + ANTIGRAVITY_QUOTA_FLAG_TTL_MS + 1000,
      )?.id,
    ).toBe(second.id); // pointer stays on second until a re-resolve
    clearAntigravityAccountQuota(dataDir, first.id);
    expect(
      listAntigravityAccounts(dataDir, now).find((a) => a.id === first.id)
        ?.quotaExhausted,
    ).toBe(false);
    expect(clearAntigravityAccountQuota(dataDir, 'ag-ffffffff')).toBeNull();
  });

  it('rejects path-traversal account ids', () => {
    expect(isValidAntigravityAccountId('../escape')).toBe(false);
    expect(isValidAntigravityAccountId('ag-zzzzzzzz')).toBe(false);
    expect(isValidAntigravityAccountId('ag-abcdef12')).toBe(true);
    expect(() => antigravityAccountHomeDir(dataDir, '../escape')).toThrow(
      /Invalid Antigravity account id/,
    );
  });
});
