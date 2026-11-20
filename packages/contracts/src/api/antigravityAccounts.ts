// Antigravity multi-account DTOs.
//
// Stock `agy` holds exactly one Google login at a time, so the fork keeps
// each connected Antigravity account in its own credential home under the
// daemon data root (`antigravity-accounts/<id>/`). A run spawns agy with
// `HOME` pointed at the active account's home, so agy reads that
// account's OAuth credentials and settings.json. When a run fails with
// `RATE_LIMITED`, the daemon flags that account quota-exhausted and the
// next run rotates to another connected account (auto-rotation between
// runs, never mid-run). Switching accounts is a one-click activate; no
// re-OAuth is needed until a stored login itself expires.
//
// The account record never carries tokens: credentials live in agy's own
// files inside the account home, exactly as stock agy stores them.

export interface AntigravityAccount {
  /** Stable id, `ag-<8 hex>`. Also the credential-home directory name. */
  id: string;
  /** User-given label, e.g. "Account 1" or the Google account email. */
  label: string;
  /** ISO-8601 creation time. */
  createdAt: string;
  /** True when this account is the one runs currently use. */
  active: boolean;
  /** True while the account is flagged quota-exhausted. */
  quotaExhausted: boolean;
  /** ISO-8601 time the quota flag expires, or null when not flagged. */
  quotaExhaustedUntil: string | null;
  /**
   * Server-local credential-home directory for this account (under the
   * daemon data root). Sign-in runs there: `HOME=<homeDir> agy`. Only
   * meaningful on the daemon host; the daemon is localhost-bound.
   */
  homeDir: string;
  /**
   * Google account email captured when the account signed in through the
   * in-app Antigravity connect flow, or null when it has never signed in
   * that way (e.g. a terminal-created account). Shown in Settings so the
   * user can tell accounts apart; never a credential.
   */
  email: string | null;
}

/** One in-app Antigravity sign-in run, driven by the daemon in a PTY. */
export type AntigravityAuthStatus =
  | 'starting'
  | 'awaiting-code'
  | 'completing'
  | 'signed-in'
  | 'error'
  | 'expired';

export interface AntigravityAuthSession {
  /** Stable id, `ag-auth-<8 hex>`. */
  id: string;
  /** The account this sign-in belongs to. */
  accountId: string;
  status: AntigravityAuthStatus;
  /**
   * Google sign-in URL, present only while `awaiting-code`. The user
   * opens it in their browser, signs in with Google, and pastes the
   * one-time code back. Never a token.
   */
  url: string | null;
  /** Signed-in Google email, present once `signed-in`. */
  email: string | null;
  /** Human-readable failure reason, present when `error` or `expired`. */
  error: string | null;
  /** ISO-8601 creation time. */
  createdAt: string;
  /** ISO-8601 last status change. */
  updatedAt: string;
}

export interface StartAntigravityAuthResponse {
  session: AntigravityAuthSession;
}

export interface AntigravityAuthSessionResponse {
  session: AntigravityAuthSession;
}

export interface SubmitAntigravityAuthCodeRequest {
  code: string;
}

export interface AntigravityAccountsResponse {
  accounts: AntigravityAccount[];
  activeAccountId: string | null;
}

export interface CreateAntigravityAccountRequest {
  label: string;
}

export interface CreateAntigravityAccountResponse {
  account: AntigravityAccount;
}
