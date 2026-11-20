// Antigravity in-app sign-in driver.
//
// Axion's login, ported to the daemon: `agy` runs in a real PTY with
// `SSH_CONNECTION` set, which makes it choose its manual "open this URL,
// paste the code" flow instead of trying to open a browser on the
// server. The daemon answers agy's terminal handshake, picks
// "1. Google OAuth", scrapes the Google sign-in URL off the screen, and
// hands it to the web UI as a clickable link. The user signs in with
// Google on their own phone and pastes the one-time code back; the
// daemon feeds it to agy, which completes the OAuth exchange and writes
// its token into the account's own credential home
// (`<RUNTIME_DATA_DIR>/antigravity-accounts/<id>/`). The daemon never
// reads the token — it only watches the screens (see
// `antigravity-auth-screens.ts`) and records the signed-in email for
// display.
//
// One active sign-in session per account; starting a new one cancels
// the old. Sessions are in-memory: a daemon restart drops them and the
// UI offers to start again. The 15-minute deadline matches Axion.

import { randomBytes } from 'node:crypto';
import type * as NodePty from 'node-pty';
import type {
  AntigravityAuthSession,
  AntigravityAuthStatus,
} from '@open-design/contracts/api/antigravityAccounts';
import {
  antigravityAccountHomeDir,
  isValidAntigravityAccountId,
  listAntigravityAccounts,
  setAntigravityAccountEmail,
} from './antigravity-accounts.js';
import {
  AGY_HANDSHAKE_QUERY,
  AGY_HANDSHAKE_REPLY,
  extractAgySignedInEmail,
  extractGoogleOAuthUrl,
  isAgySignedInScreen,
  sanitizeAgyOutput,
} from './antigravity-auth-screens.js';
import { isNodePtyUnavailableError, loadNodePty } from './node-pty.js';

/** Sign-in runs at most this long before the session expires. */
export const ANTIGRAVITY_AUTH_DEADLINE_MS = 15 * 60 * 1000;

/** Raw PTY output kept for handshake/screen matching (head-trimmed). */
const MAX_RAW_OUTPUT_CHARS = 200_000;
/** Sanitized tail the screen matchers read. */
const SCREEN_TAIL_CHARS = 40_000;

function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

export function isAntigravityAuthErrorCode(
  error: unknown,
  code: string,
): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

interface InternalSession {
  id: string;
  accountId: string;
  status: AntigravityAuthStatus;
  url: string | null;
  email: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  pty: NodePty.IPty | null;
  raw: string;
  handshakes: number;
  lastHandshakeAt: number;
  menuAnswered: boolean;
  colorAnswered: boolean;
  renderAnswered: boolean;
  privacyAnswered: boolean;
  trustAnswered: boolean;
  quitSent: boolean;
  deadlineTimer: NodeJS.Timeout | null;
}

export interface AntigravityAuthManager {
  start(accountId: string): Promise<AntigravityAuthSession>;
  get(accountId: string): AntigravityAuthSession | null;
  submitCode(accountId: string, code: string): AntigravityAuthSession;
  cancel(accountId: string): AntigravityAuthSession | null;
}

function toPublicSession(session: InternalSession): AntigravityAuthSession {
  return {
    id: session.id,
    accountId: session.accountId,
    status: session.status,
    url: session.url,
    email: session.email,
    error: session.error,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function isTerminal(status: AntigravityAuthStatus): boolean {
  return status === 'signed-in' || status === 'error' || status === 'expired';
}

export function createAntigravityAuthManager(
  dataDir: string,
): AntigravityAuthManager {
  const sessions = new Map<string, InternalSession>();

  function setStatus(
    session: InternalSession,
    status: AntigravityAuthStatus,
    error: string | null = null,
  ): void {
    session.status = status;
    if (error !== null) session.error = error;
    session.updatedAt = new Date().toISOString();
  }

  function clearDeadline(session: InternalSession): void {
    if (session.deadlineTimer) {
      clearTimeout(session.deadlineTimer);
      session.deadlineTimer = null;
    }
  }

  function kill(session: InternalSession): void {
    clearDeadline(session);
    const pty = session.pty;
    session.pty = null;
    if (pty) {
      try {
        pty.kill();
      } catch {
        // Already dead — the exit handler finalizes the state.
      }
    }
  }

  function drive(session: InternalSession, chunk: string): void {
    session.raw += chunk;
    if (session.raw.length > MAX_RAW_OUTPUT_CHARS) {
      const dropped = session.raw.length - MAX_RAW_OUTPUT_CHARS;
      session.raw = session.raw.slice(dropped);
      session.lastHandshakeAt = Math.max(0, session.lastHandshakeAt - dropped);
    }
    // Kitty keyboard-protocol handshake: agy (Ink) asks `ESC[?u`; answer
    // so it stays in raw mode and Enter/arrow keys behave.
    if (
      session.handshakes < 5 &&
      session.raw.length - session.lastHandshakeAt > 200 &&
      session.raw.slice(session.lastHandshakeAt).includes(AGY_HANDSHAKE_QUERY)
    ) {
      write(session, AGY_HANDSHAKE_REPLY);
      session.handshakes += 1;
      session.lastHandshakeAt = session.raw.length;
    }
    const clean = sanitizeAgyOutput(session.raw).slice(-SCREEN_TAIL_CHARS);
    // Login-method menu: pick "1. Google OAuth" (the highlighted first
    // row) — but only before any URL appears.
    if (
      session.handshakes > 0 &&
      !session.menuAnswered &&
      clean.toLowerCase().includes('select login method') &&
      clean.includes('> 1. Google OAuth') &&
      extractGoogleOAuthUrl(clean) === null
    ) {
      write(session, '\r\n');
      session.menuAnswered = true;
    }
    const url = extractGoogleOAuthUrl(clean);
    if (url !== null && session.status === 'starting') {
      session.url = url;
      setStatus(session, 'awaiting-code');
    }
    if (isAgySignedInScreen(clean)) {
      const email = extractAgySignedInEmail(clean);
      if (email !== null) session.email = email;
      write(session, '/quit\r\n');
      session.quitSent = true;
      if (session.status !== 'signed-in') setStatus(session, 'completing');
      return;
    }
    if (!session.colorAnswered && clean.toLowerCase().includes('choose your color scheme')) {
      write(session, '\r\n');
      session.colorAnswered = true;
    }
    if (
      !session.renderAnswered &&
      clean.toLowerCase().includes('no flickering (altscreen)') &&
      clean.toLowerCase().includes('native terminal experience (inline)')
    ) {
      write(session, '\u001b[B\r\n');
      session.renderAnswered = true;
    }
    if (
      !session.privacyAnswered &&
      clean.toLowerCase().includes('terms of service & data use') &&
      clean.toLowerCase().includes('help improve antigravity cli')
    ) {
      // Opt OUT of data collection: uncheck "Yes" when it is checked,
      // then move on.
      write(session, clean.toLowerCase().includes('[x] yes') ? ' \t\t\r\n' : '\t\t\r\n');
      session.privacyAnswered = true;
      if (session.status === 'starting') setStatus(session, 'completing');
    }
    if (
      !session.trustAnswered &&
      clean.toLowerCase().includes('do you trust the contents of this project') &&
      clean.toLowerCase().includes('yes, i trust this folder')
    ) {
      write(session, '\r\n');
      session.trustAnswered = true;
    }
    const lower = clean.toLowerCase();
    if (
      lower.includes('authentication failed') ||
      lower.includes('failed to exchange')
    ) {
      fail(
        session,
        'Google sign-in failed. Start again and paste a fresh code.',
      );
    }
  }

  function write(session: InternalSession, data: string): void {
    try {
      session.pty?.write(data);
    } catch {
      // PTY already gone — the exit handler finalizes the state.
    }
  }

  function fail(session: InternalSession, message: string): void {
    if (isTerminal(session.status)) return;
    kill(session);
    setStatus(session, 'error', message);
  }

  function onExit(session: InternalSession, exitCode: number): void {
    session.pty = null;
    clearDeadline(session);
    if (session.status === 'signed-in') return;
    if (session.quitSent) {
      // agy exited after the signed-in screen: the login landed. Record
      // the email on the account so Settings can show which Google
      // account this entry is.
      if (session.email) {
        setAntigravityAccountEmail(dataDir, session.accountId, session.email);
      }
      setStatus(session, 'signed-in');
      return;
    }
    if (isTerminal(session.status)) return;
    fail(
      session,
      `Antigravity closed before sign-in finished (exit ${exitCode}). Start again.`,
    );
  }

  async function start(accountId: string): Promise<AntigravityAuthSession> {
    if (!isValidAntigravityAccountId(accountId)) {
      throw errorWithCode('invalid account id', 'INVALID_ACCOUNT_ID');
    }
    const account = listAntigravityAccounts(dataDir).find(
      (candidate) => candidate.id === accountId,
    );
    if (!account) {
      throw errorWithCode('account not found', 'ACCOUNT_NOT_FOUND');
    }
    const existing = sessions.get(accountId);
    if (existing) kill(existing);

    const now = new Date().toISOString();
    const session: InternalSession = {
      id: `ag-auth-${randomBytes(4).toString('hex')}`,
      accountId,
      status: 'starting',
      url: null,
      email: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      pty: null,
      raw: '',
      handshakes: 0,
      lastHandshakeAt: 0,
      menuAnswered: false,
      colorAnswered: false,
      renderAnswered: false,
      privacyAnswered: false,
      trustAnswered: false,
      quitSent: false,
      deadlineTimer: null,
    };
    sessions.set(accountId, session);

    let pty: NodePty.IPty;
    try {
      const nodePty = await loadNodePty();
      const homeDir = antigravityAccountHomeDir(dataDir, accountId);
      pty = nodePty.spawn(process.env.AGY_PATH ?? 'agy', [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: homeDir,
        env: {
          ...process.env,
          HOME: homeDir,
          // Forces agy's manual "open this URL, paste the code" flow
          // (same trick Axion uses): without it agy tries to open a
          // browser on the server, which has none.
          SSH_CONNECTION: '127.0.0.1 1 127.0.0.1 1',
          TERM: 'xterm-256color',
          NO_COLOR: '1',
        },
      });
    } catch (err) {
      sessions.delete(accountId);
      if (isNodePtyUnavailableError(err)) {
        throw errorWithCode(
          'The terminal helper needed for Antigravity sign-in is unavailable.',
          'PTY_UNAVAILABLE',
        );
      }
      throw errorWithCode(
        `Could not start Antigravity sign-in: ${err instanceof Error ? err.message : String(err)}`,
        'SPAWN_FAILED',
      );
    }
    session.pty = pty;
    session.deadlineTimer = setTimeout(() => {
      if (isTerminal(session.status)) return;
      kill(session);
      setStatus(session, 'expired', 'Sign-in expired. Start again.');
    }, ANTIGRAVITY_AUTH_DEADLINE_MS);
    session.deadlineTimer.unref?.();
    pty.onData((chunk: string) => {
      if (isTerminal(session.status) && !session.quitSent) return;
      try {
        drive(session, chunk);
      } catch (err) {
        fail(
          session,
          err instanceof Error ? err.message : 'Sign-in failed.',
        );
      }
    });
    pty.onExit(({ exitCode }: { exitCode: number }) => {
      onExit(session, exitCode);
    });
    return toPublicSession(session);
  }

  function get(accountId: string): AntigravityAuthSession | null {
    const session = sessions.get(accountId);
    return session ? toPublicSession(session) : null;
  }

  function submitCode(accountId: string, code: string): AntigravityAuthSession {
    const session = sessions.get(accountId);
    if (!session) {
      throw errorWithCode('no sign-in in progress for this account', 'NO_SESSION');
    }
    if (!code.trim()) {
      throw errorWithCode('Paste the code from Google', 'CODE_REQUIRED');
    }
    if (session.status !== 'awaiting-code') {
      throw errorWithCode(
        'This sign-in is not waiting for a code. Start again.',
        'NOT_AWAITING_CODE',
      );
    }
    write(session, `${code.trim()}\r\n`);
    setStatus(session, 'completing');
    return toPublicSession(session);
  }

  function cancel(accountId: string): AntigravityAuthSession | null {
    const session = sessions.get(accountId);
    if (!session) return null;
    if (!isTerminal(session.status)) {
      kill(session);
      setStatus(session, 'error', 'Sign-in cancelled.');
    }
    return toPublicSession(session);
  }

  return { start, get, submitCode, cancel };
}
