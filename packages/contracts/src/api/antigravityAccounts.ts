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
