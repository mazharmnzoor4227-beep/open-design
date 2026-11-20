import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AntigravityAccount,
  AntigravityAuthSession,
} from '@open-design/contracts/api/antigravityAccounts';
import { useT } from '../i18n';
import {
  ANTIGRAVITY_AUTH_POLL_MS,
  activateAntigravityAccount,
  cancelAntigravityAuth,
  clearAntigravityAccountQuota,
  createAntigravityAccount,
  fetchAntigravityAccounts,
  fetchAntigravityAuth,
  removeAntigravityAccount,
  startAntigravityAuth,
  submitAntigravityAuthCode,
} from '../providers/antigravity-accounts';
import styles from './AntigravityAccounts.module.css';

// Antigravity multi-account manager (Settings → Execution, under the
// agent grid). Stock `agy` holds one Google login at a time; the fork
// keeps one credential home per connected account, so up to 5 accounts
// can be connected and runs rotate to the next one when the active
// account hits its quota.
//
// Signing in is Axion-style and needs no terminal: the daemon runs `agy`
// in a PTY, shows the Google sign-in URL as a clickable link, and the
// user pastes the one-time code back. Same endpoints as
// `od antigravity auth …`.

interface Props {
  /** True when the agy CLI was detected on PATH. The panel hides
   *  itself when agy is missing AND no accounts exist yet. */
  antigravityAvailable: boolean;
}

function formatQuotaUntil(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isTerminalAuthStatus(status: AntigravityAuthSession['status']): boolean {
  return status === 'signed-in' || status === 'error' || status === 'expired';
}

export function AntigravityAccounts({ antigravityAvailable }: Props) {
  const t = useT();
  const [accounts, setAccounts] = useState<AntigravityAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  // One live sign-in session per account (in-memory on the daemon).
  const [authById, setAuthById] = useState<
    Record<string, AntigravityAuthSession>
  >({});
  const [authCodeById, setAuthCodeById] = useState<Record<string, string>>({});
  const [authBusyById, setAuthBusyById] = useState<Record<string, boolean>>({});
  const [authErrorById, setAuthErrorById] = useState<
    Record<string, string | null>
  >({});

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAntigravityAccounts();
      setAccounts(data.accounts);
      setLoadError(null);
      // Drop sign-in state for accounts that no longer exist so a
      // removed account's session can never keep the poller alive.
      const ids = new Set(data.accounts.map((account) => account.id));
      setAuthById((prev) => {
        const next: Record<string, AntigravityAuthSession> = {};
        for (const [id, session] of Object.entries(prev)) {
          if (ids.has(id)) next[id] = session;
        }
        return next;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const liveAuthIds = useMemo(
    () =>
      Object.values(authById)
        .filter((session) => !isTerminalAuthStatus(session.status))
        .map((session) => session.accountId),
    [authById],
  );

  // Re-read live sign-ins every 2s until they land (signed-in / error /
  // expired). A failed tick keeps the last known session; the next tick
  // retries.
  useEffect(() => {
    if (liveAuthIds.length === 0) return undefined;
    const timer = setInterval(() => {
      void (async () => {
        for (const id of liveAuthIds) {
          try {
            const session = await fetchAntigravityAuth(id);
            setAuthById((prev) => ({ ...prev, [id]: session }));
            if (session.status === 'signed-in') void refresh();
          } catch {
            // Keep the last known session; the next tick retries.
          }
        }
      })();
    }, ANTIGRAVITY_AUTH_POLL_MS);
    return () => clearInterval(timer);
  }, [liveAuthIds, refresh]);

  const startAuth = useCallback(async (id: string) => {
    setAuthBusyById((prev) => ({ ...prev, [id]: true }));
    setAuthErrorById((prev) => ({ ...prev, [id]: null }));
    try {
      const session = await startAntigravityAuth(id);
      setAuthById((prev) => ({ ...prev, [id]: session }));
      setAuthCodeById((prev) => ({ ...prev, [id]: '' }));
    } catch (err) {
      setAuthErrorById((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setAuthBusyById((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  const submitAuthCode = useCallback(
    async (id: string) => {
      const code = (authCodeById[id] ?? '').trim();
      if (!code || authBusyById[id]) return;
      setAuthBusyById((prev) => ({ ...prev, [id]: true }));
      setAuthErrorById((prev) => ({ ...prev, [id]: null }));
      try {
        const session = await submitAntigravityAuthCode(id, code);
        setAuthById((prev) => ({ ...prev, [id]: session }));
      } catch (err) {
        setAuthErrorById((prev) => ({
          ...prev,
          [id]: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setAuthBusyById((prev) => ({ ...prev, [id]: false }));
      }
    },
    [authBusyById, authCodeById],
  );

  const cancelAuth = useCallback(async (id: string) => {
    setAuthBusyById((prev) => ({ ...prev, [id]: true }));
    try {
      const session = await cancelAntigravityAuth(id);
      setAuthById((prev) => ({ ...prev, [id]: session }));
    } catch (err) {
      setAuthErrorById((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setAuthBusyById((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  if (accounts !== null && accounts.length === 0 && !antigravityAvailable) {
    return null;
  }

  const runAction = async (
    id: string,
    action: () => Promise<unknown>,
  ): Promise<void> => {
    setBusyId(id);
    try {
      await action();
      await refresh();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = async (): Promise<void> => {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const account = await createAntigravityAccount(trimmed);
      setLabel('');
      await refresh();
      // Open the Google sign-in for the new account straight away.
      await startAuth(account.id);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.root} aria-label={t('settings.antigravityAccountsTitle')}>
      <h3 className={styles.title}>{t('settings.antigravityAccountsTitle')}</h3>
      <p className="hint">{t('settings.antigravityAccountsHint')}</p>
      {loadError ? <p className={styles.error}>{loadError}</p> : null}
      {accounts === null ? (
        <p className="hint">{t('settings.antigravityAccountsLoading')}</p>
      ) : accounts.length === 0 ? (
        <p className="hint">{t('settings.antigravityAccountsEmpty')}</p>
      ) : (
        <ul className={styles.list}>
          {accounts.map((account) => {
            const auth = authById[account.id] ?? null;
            const authLive = auth !== null && !isTerminalAuthStatus(auth.status);
            const authError = authErrorById[account.id] ?? null;
            const connectedEmail = auth?.email ?? account.email;
            return (
              <li key={account.id} className={styles.row}>
                <div className={styles.rowBody}>
                  <span className={styles.label}>{account.label}</span>
                  <span className={styles.badges}>
                    {account.active ? (
                      <span className={styles.badgeActive}>
                        {t('settings.antigravityAccountActive')}
                      </span>
                    ) : null}
                    {account.quotaExhausted && account.quotaExhaustedUntil ? (
                      <span className={styles.badgeQuota}>
                        {t('settings.antigravityAccountQuotaExhausted', {
                          until: formatQuotaUntil(account.quotaExhaustedUntil),
                        })}
                      </span>
                    ) : null}
                  </span>
                  {connectedEmail ? (
                    <span className={styles.email}>
                      {t('settings.antigravityConnectedAs', {
                        email: connectedEmail,
                      })}
                    </span>
                  ) : null}
                </div>
                <div className={styles.actions}>
                  {!authLive ? (
                    <button
                      type="button"
                      className="ghost settings-test-btn"
                      disabled={authBusyById[account.id] === true}
                      onClick={() => void startAuth(account.id)}
                    >
                      {t('settings.antigravityAccountConnect')}
                    </button>
                  ) : null}
                  {!account.active ? (
                    <button
                      type="button"
                      className="ghost settings-test-btn"
                      disabled={busyId === account.id}
                      onClick={() =>
                        void runAction(account.id, () =>
                          activateAntigravityAccount(account.id),
                        )
                      }
                    >
                      {t('settings.antigravityAccountSwitch')}
                    </button>
                  ) : null}
                  {account.quotaExhausted ? (
                    <button
                      type="button"
                      className="ghost settings-test-btn"
                      disabled={busyId === account.id}
                      onClick={() =>
                        void runAction(account.id, () =>
                          clearAntigravityAccountQuota(account.id),
                        )
                      }
                    >
                      {t('settings.antigravityAccountClearQuota')}
                    </button>
                  ) : null}
                  {confirmingRemoveId === account.id ? (
                    <button
                      type="button"
                      className="ghost settings-test-btn"
                      disabled={busyId === account.id}
                      onClick={() => {
                        setConfirmingRemoveId(null);
                        void runAction(account.id, () =>
                          removeAntigravityAccount(account.id),
                        );
                      }}
                    >
                      {t('settings.antigravityAccountRemoveConfirm')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost settings-test-btn"
                      onClick={() => setConfirmingRemoveId(account.id)}
                    >
                      {t('settings.antigravityAccountRemove')}
                    </button>
                  )}
                </div>
                {auth !== null ? (
                  <div className={styles.signIn}>
                    <p className={styles.signInTitle}>
                      {t('settings.antigravityAccountSignInTitle')}
                    </p>
                    {authError ? <p className={styles.error}>{authError}</p> : null}
                    {auth.status === 'starting' ||
                    auth.status === 'completing' ? (
                      <p className="hint">
                        {t('settings.antigravityAuthWaiting')}
                      </p>
                    ) : null}
                    {auth.status === 'awaiting-code' && auth.url ? (
                      <>
                        <a
                          className={styles.authLink}
                          href={auth.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('settings.antigravitySignInOpenLink')}
                        </a>
                        <p className="hint">
                          {t('settings.antigravityCodeHint')}
                        </p>
                        <div className={styles.authCodeRow}>
                          <input
                            type="text"
                            value={authCodeById[account.id] ?? ''}
                            placeholder={t(
                              'settings.antigravityCodePlaceholder',
                            )}
                            aria-label={t('settings.antigravityCodeLabel')}
                            autoComplete="off"
                            onChange={(event) =>
                              setAuthCodeById((prev) => ({
                                ...prev,
                                [account.id]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter')
                                void submitAuthCode(account.id);
                            }}
                          />
                          <button
                            type="button"
                            className="settings-test-btn"
                            disabled={
                              !(authCodeById[account.id] ?? '').trim() ||
                              authBusyById[account.id] === true
                            }
                            onClick={() => void submitAuthCode(account.id)}
                          >
                            {t('settings.antigravityCodeSubmit')}
                          </button>
                        </div>
                      </>
                    ) : null}
                    {auth.status === 'signed-in' ? (
                      <p className="hint">
                        {t('settings.antigravityConnectedAs', {
                          email:
                            auth.email ?? account.email ?? account.label,
                        })}
                      </p>
                    ) : null}
                    {auth.status === 'error' ? (
                      <>
                        <p className={styles.error}>
                          {auth.error ??
                            t('settings.antigravityAuthFailed')}
                        </p>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className="ghost settings-test-btn"
                            disabled={authBusyById[account.id] === true}
                            onClick={() => void startAuth(account.id)}
                          >
                            {t('settings.antigravityAccountConnect')}
                          </button>
                        </div>
                      </>
                    ) : null}
                    {auth.status === 'expired' ? (
                      <>
                        <p className="hint">
                          {t('settings.antigravityAuthExpired')}
                        </p>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className="ghost settings-test-btn"
                            disabled={authBusyById[account.id] === true}
                            onClick={() => void startAuth(account.id)}
                          >
                            {t('settings.antigravityAccountConnect')}
                          </button>
                        </div>
                      </>
                    ) : null}
                    {authLive ? (
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className="ghost settings-test-btn"
                          disabled={authBusyById[account.id] === true}
                          onClick={() => void cancelAuth(account.id)}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.addRow}>
        <input
          type="text"
          value={label}
          maxLength={64}
          placeholder={t('settings.antigravityAccountAddLabel')}
          aria-label={t('settings.antigravityAccountAddLabel')}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleAdd();
          }}
        />
        <button
          type="button"
          className="settings-test-btn"
          disabled={!label.trim() || busy}
          onClick={() => void handleAdd()}
        >
          {t('settings.antigravityAccountAdd')}
        </button>
      </div>
    </section>
  );
}
