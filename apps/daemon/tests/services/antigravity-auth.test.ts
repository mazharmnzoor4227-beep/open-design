// Antigravity in-app sign-in manager — validation paths only. Starting a
// real sign-in spawns `agy` in a PTY, so live-flow coverage lives in the
// server-side verification (URL generation + code-paste channel), not
// here. These tests pin the request-validation contract the routes and
// the CLI rely on, plus the account-email recording.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAntigravityAccount,
  listAntigravityAccounts,
  setAntigravityAccountEmail,
} from '../../src/services/antigravity-accounts.js';
import {
  createAntigravityAuthManager,
  isAntigravityAuthErrorCode,
} from '../../src/services/antigravity-auth.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'od-agy-auth-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('antigravity auth manager validation', () => {
  it('get returns null when no sign-in is in progress', () => {
    const auth = createAntigravityAuthManager(dataDir);
    expect(auth.get('ag-01234567')).toBeNull();
  });

  it('cancel returns null when no sign-in is in progress', () => {
    const auth = createAntigravityAuthManager(dataDir);
    expect(auth.cancel('ag-01234567')).toBeNull();
  });

  it('submitCode without a session reports NO_SESSION', () => {
    const auth = createAntigravityAuthManager(dataDir);
    expect(() => auth.submitCode('ag-01234567', '4/0ABC')).toThrowError();
    try {
      auth.submitCode('ag-01234567', '4/0ABC');
    } catch (err) {
      expect(isAntigravityAuthErrorCode(err, 'NO_SESSION')).toBe(true);
    }
  });

  it('start rejects a malformed account id', async () => {
    const auth = createAntigravityAuthManager(dataDir);
    await expect(auth.start('not-an-id')).rejects.toThrowError();
    try {
      await auth.start('not-an-id');
    } catch (err) {
      expect(isAntigravityAuthErrorCode(err, 'INVALID_ACCOUNT_ID')).toBe(true);
    }
  });

  it('start reports ACCOUNT_NOT_FOUND for an unknown account', async () => {
    const auth = createAntigravityAuthManager(dataDir);
    await expect(auth.start('ag-01234567')).rejects.toThrowError();
    try {
      await auth.start('ag-01234567');
    } catch (err) {
      expect(isAntigravityAuthErrorCode(err, 'ACCOUNT_NOT_FOUND')).toBe(true);
    }
  });
});

describe('antigravity account email', () => {
  it('records the signed-in email and lists it on the account', () => {
    const account = createAntigravityAccount(dataDir, 'Account 1');
    expect(account.email).toBeNull();
    const updated = setAntigravityAccountEmail(
      dataDir,
      account.id,
      'mazharmanzoor4117@gmail.com',
    );
    expect(updated?.email).toBe('mazharmanzoor4117@gmail.com');
    expect(listAntigravityAccounts(dataDir)[0]?.email).toBe(
      'mazharmanzoor4117@gmail.com',
    );
  });

  it('returns null for an unknown account', () => {
    expect(
      setAntigravityAccountEmail(dataDir, 'ag-01234567', 'a@b.com'),
    ).toBeNull();
  });

  it('old registry records without an email read back as null', () => {
    const account = createAntigravityAccount(dataDir, 'Account 1');
    expect(listAntigravityAccounts(dataDir)[0]?.email).toBeNull();
    expect(account.email).toBeNull();
  });
});
