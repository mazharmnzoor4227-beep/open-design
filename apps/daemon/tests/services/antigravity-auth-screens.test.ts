// Antigravity PTY screen helpers — ported from Axion's AgyScreens.
// The fixtures mirror what `agy` actually prints: the OAuth URL's query
// parameters are alphabetically ordered (Go's url.Values.Encode), so
// `code_challenge` precedes `state`, which is also the last parameter.

import { describe, expect, it } from 'vitest';
import {
  AGY_HANDSHAKE_QUERY,
  AGY_HANDSHAKE_REPLY,
  extractAgySignedInEmail,
  extractGoogleOAuthUrl,
  isAgySignedInScreen,
  sanitizeAgyOutput,
} from '../../src/services/antigravity-auth-screens.js';

const OAUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&client_id=123456789-abcdef.apps.googleusercontent.com&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&scope=openid%20email%20profile&state=abcDEF123-_~.456';

describe('sanitizeAgyOutput', () => {
  it('strips ANSI escapes and control characters but keeps newlines', () => {
    const raw = '\u001b[1mBold\u001b[0m text\n\u001b[?25lnext\u0007line';
    expect(sanitizeAgyOutput(raw)).toBe('Bold text\nnextline');
  });

  it('strips ANSI escapes — including the kitty handshake query, which the manager detects on the raw output instead', () => {
    const raw = '\u001b[1mBold\u001b[0m text\n\u001b[?25lnext\u0007line';
    expect(sanitizeAgyOutput(raw)).toBe('Bold text\nnextline');
    expect(sanitizeAgyOutput(`prefix${AGY_HANDSHAKE_QUERY}suffix`)).toBe(
      'prefixsuffix',
    );
  });
});

describe('AGY_HANDSHAKE_REPLY', () => {
  it('answers the kitty keyboard-protocol query', () => {
    expect(AGY_HANDSHAKE_REPLY).toContain('\u001b[?2026;1$y');
    expect(AGY_HANDSHAKE_REPLY).toContain('\u001b[?2027;1$y');
    expect(AGY_HANDSHAKE_REPLY).toContain('\u001b[?1u');
  });
});

describe('extractGoogleOAuthUrl', () => {
  it('finds the full OAuth URL on the sign-in screen', () => {
    // Real agy layout: "Open the URL below in your browser:", the URL,
    // then a box-drawing border — the border (not letters) terminates
    // the state token after compaction.
    const screen = [
      'Open the URL below in your browser:',
      OAUTH_URL,
      '─'.repeat(40),
      '(1 of 31 lines)',
    ].join('\n');
    expect(extractGoogleOAuthUrl(screen)).toBe(OAUTH_URL);
  });

  it('finds the URL when it wraps across terminal lines (real agy output)', () => {
    // agy prints the ~600-char URL wrapped at the terminal width; the
    // state parameter is last, so compaction re-joins the lines and the
    // border after the URL terminates the state token.
    const wrapped = OAUTH_URL.match(/.{1,80}/g)?.join('\r\n') ?? OAUTH_URL;
    const screen = [
      'Open the URL below in your browser:',
      wrapped,
      '─'.repeat(40),
      'shift+up/down Navigate  Signing in...',
    ].join('\n');
    expect(extractGoogleOAuthUrl(screen)).toBe(OAUTH_URL);
  });

  it('finds the URL when ANSI colours wrap it', () => {
    const screen = `Open this URL:\n\u001b[36m${OAUTH_URL}\u001b[0m\n`;
    expect(extractGoogleOAuthUrl(screen)).toBe(OAUTH_URL);
  });

  it('returns null on the login-method menu (no URL yet)', () => {
    const screen = [
      'Select login method',
      '> 1. Google OAuth',
      '  2. API key',
    ].join('\n');
    expect(extractGoogleOAuthUrl(screen)).toBeNull();
  });

  it('returns null when the URL lacks the OAuth parameters', () => {
    expect(
      extractGoogleOAuthUrl('Visit https://accounts.google.com/ for help'),
    ).toBeNull();
  });

  it('falls back to any long https URL on a browser/code screen', () => {
    const screen = 'Open your browser and visit https://example.com/sign-in/abcdefghijklmnopqrstuvwxyz to continue';
    expect(extractGoogleOAuthUrl(screen)).toBe(
      'https://example.com/sign-in/abcdefghijklmnopqrstuvwxyz',
    );
  });
});

describe('isAgySignedInScreen', () => {
  it('recognises the shortcuts hint', () => {
    expect(isAgySignedInScreen('Press ? for shortcuts')).toBe(true);
  });

  it('recognises the main screen branding', () => {
    expect(
      isAgySignedInScreen('Antigravity CLI — Google AI at your fingertips'),
    ).toBe(true);
  });

  it('rejects the login and setup screens', () => {
    expect(isAgySignedInScreen('Select login method\n> 1. Google OAuth')).toBe(false);
    expect(isAgySignedInScreen('Choose your color scheme')).toBe(false);
  });
});

describe('extractAgySignedInEmail', () => {
  it('reads the signed-in email off the main screen', () => {
    expect(
      extractAgySignedInEmail('Signed in as mazharmanzoor4117@gmail.com\nAntigravity CLI'),
    ).toBe('mazharmanzoor4117@gmail.com');
  });

  it('skips the OAuth client id', () => {
    expect(
      extractAgySignedInEmail(
        'client 123456789-abcdef.apps.googleusercontent.com signed in as user@example.com',
      ),
    ).toBe('user@example.com');
  });

  it('returns null when no email is on screen', () => {
    expect(extractAgySignedInEmail('Antigravity CLI\nPress ? for shortcuts')).toBeNull();
  });
});
