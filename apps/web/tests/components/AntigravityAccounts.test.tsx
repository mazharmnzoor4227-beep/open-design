// @vitest-environment jsdom

/**
 * Coverage for the Antigravity Settings connect flow (fork step 2):
 * tap Connect → Google sign-in link + one-time code field → submit →
 * connected-as email. The old terminal command (`HOME=… agy`) must not
 * appear anywhere. The daemon runs `agy` in a PTY; the UI only shows
 * the link and the code field.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AntigravityAccounts } from '../../src/components/AntigravityAccounts';
import { I18nProvider } from '../../src/i18n';
import type {
  AntigravityAccount,
  AntigravityAuthSession,
} from '@open-design/contracts/api/antigravityAccounts';
import { ANTIGRAVITY_AUTH_POLL_MS } from '../../src/providers/antigravity-accounts';

const mocks = vi.hoisted(() => ({
  fetchAccounts: vi.fn(),
  createAccount: vi.fn(),
  activateAccount: vi.fn(),
  clearQuota: vi.fn(),
  removeAccount: vi.fn(),
  startAuth: vi.fn(),
  fetchAuth: vi.fn(),
  submitCode: vi.fn(),
  cancelAuth: vi.fn(),
}));

vi.mock('../../src/providers/antigravity-accounts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/providers/antigravity-accounts')>();
  return {
    ...actual,
    fetchAntigravityAccounts: mocks.fetchAccounts,
    createAntigravityAccount: mocks.createAccount,
    activateAntigravityAccount: mocks.activateAccount,
    clearAntigravityAccountQuota: mocks.clearQuota,
    removeAntigravityAccount: mocks.removeAccount,
    startAntigravityAuth: mocks.startAuth,
    fetchAntigravityAuth: mocks.fetchAuth,
    submitAntigravityAuthCode: mocks.submitCode,
    cancelAntigravityAuth: mocks.cancelAuth,
  };
});

const account: AntigravityAccount = {
  id: 'ag-abcdef01',
  label: 'Account 1',
  createdAt: '2026-11-20T00:00:00.000Z',
  active: true,
  quotaExhausted: false,
  quotaExhaustedUntil: null,
  homeDir: '/data/antigravity-accounts/ag-abcdef01',
  email: null,
};

function session(
  overrides: Partial<AntigravityAuthSession>,
): AntigravityAuthSession {
  return {
    id: 'ag-auth-12345678',
    accountId: account.id,
    status: 'starting',
    url: null,
    email: null,
    error: null,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {});
}

async function advancePoll(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ANTIGRAVITY_AUTH_POLL_MS);
  });
}

function renderPanel(): void {
  render(
    <I18nProvider initial="en">
      <AntigravityAccounts antigravityAvailable />
    </I18nProvider>,
  );
}

describe('AntigravityAccounts connect flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchAccounts.mockResolvedValue({
      accounts: [account],
      activeAccountId: account.id,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows a Connect button and no terminal command', async () => {
    renderPanel();
    await flush();

    expect(screen.getByText('Account 1')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Connect' }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('HOME=');
    expect(document.body.textContent).not.toContain('agy');
  });

  it('Connect → sign-in link → code → connected-as email', async () => {
    const url =
      'https://accounts.google.com/o/oauth2/auth?state=abc&client_id=x';
    mocks.startAuth.mockResolvedValue(session({ status: 'starting' }));
    mocks.fetchAuth.mockResolvedValue(
      session({ status: 'awaiting-code', url }),
    );
    mocks.submitCode.mockResolvedValue(session({ status: 'completing' }));

    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await flush();
    expect(mocks.startAuth).toHaveBeenCalledWith(account.id);

    // The 2s poll picks up the Google sign-in URL.
    await advancePoll();
    const link = screen.getByRole('link', { name: 'Open Google sign-in' });
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('target')).toBe('_blank');

    const codeInput = screen.getByPlaceholderText('Paste the code from Google');
    fireEvent.change(codeInput, { target: { value: '4/0CODE' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete sign-in' }),
    );
    await flush();
    expect(mocks.submitCode).toHaveBeenCalledWith(account.id, '4/0CODE');

    // The poll reports the signed-in email; the row and the panel show it.
    mocks.fetchAuth.mockResolvedValue(
      session({ status: 'signed-in', email: 'mazhar@example.com' }),
    );
    await advancePoll();
    expect(
      screen.getAllByText('Connected as mazhar@example.com').length,
    ).toBeGreaterThan(0);
  });

  it('adding an account starts its sign-in straight away', async () => {
    const added: AntigravityAccount = {
      ...account,
      id: 'ag-abcdef02',
      label: 'Account 2',
      active: false,
    };
    mocks.createAccount.mockResolvedValue(added);
    mocks.fetchAccounts.mockResolvedValue({
      accounts: [account, added],
      activeAccountId: account.id,
    });
    mocks.startAuth.mockResolvedValue(session({ status: 'starting' }));

    renderPanel();
    await flush();

    fireEvent.change(
      screen.getByPlaceholderText('Account label, e.g. Account 1'),
      { target: { value: 'Account 2' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await flush();

    expect(mocks.createAccount).toHaveBeenCalledWith('Account 2');
    expect(mocks.startAuth).toHaveBeenCalledWith(added.id);
    expect(screen.getByText('Account 2')).toBeTruthy();
  });
});
