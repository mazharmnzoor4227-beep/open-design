import { useCallback, useEffect, useState } from 'react';
import type { AntigravityAccount } from '@open-design/contracts/api/antigravityAccounts';
import { useT } from '../i18n';
import {
  activateAntigravityAccount,
  clearAntigravityAccountQuota,
  createAntigravityAccount,
  fetchAntigravityAccounts,
  removeAntigravityAccount,
} from '../providers/antigravity-accounts';
import styles from './AntigravityAccounts.module.css';

// Antigravity multi-account manager (Settings → Execution, under the
// agent grid). Stock `agy` holds one Google login at a time; the fork
// keeps one credential home per connected account, so up to 5 accounts
// can be connected and runs rotate to the next one when the active
// account hits its quota. Adding an account only creates the registry
// entry + home dir — the Google sign-in itself happens in a terminal
// on the daemon host (`HOME=<homeDir> agy`), whose command this panel
// shows after adding. Same endpoints as `od antigravity accounts …`.

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

export function AntigravityAccounts({ antigravityAvailable }: Props) {
  const t = useT();
  const [accounts, setAccounts] = useState<AntigravityAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<AntigravityAccount | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAntigravityAccounts();
      setAccounts(data.accounts);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      setJustAdded(account);
      await refresh();
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
          {accounts.map((account) => (
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
              </div>
              <div className={styles.actions}>
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
            </li>
          ))}
        </ul>
      )}
      {justAdded ? (
        <div className={styles.signIn}>
          <p className={styles.signInTitle}>
            {t('settings.antigravityAccountSignInTitle')}
          </p>
          <p className="hint">{t('settings.antigravityAccountSignInHint')}</p>
          <code className={styles.signInCommand}>
            HOME={justAdded.homeDir} agy
          </code>
        </div>
      ) : null}
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
