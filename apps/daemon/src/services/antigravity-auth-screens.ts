// Antigravity CLI terminal-screen helpers — pure string functions.
//
// Ported from the Axion app's `AgyScreens` (Kodex's
// AntigravityAuthController logic, as ported into Axion's AgyLogin.kt):
// `agy` runs in a real PTY and drives a full-screen TUI, so the daemon
// reads its screens from the raw PTY output instead of any API. These
// helpers are the whole screen contract — sanitize ANSI, find the Google
// OAuth URL, recognise the signed-in screen, and read the signed-in
// email. They carry no Node APIs so the daemon tests can cover them
// without spawning a PTY.

/**
 * Kitty keyboard-protocol handshake reply. agy (Ink) asks the terminal
 * for its keyboard capabilities (`ESC[?u`); answering keeps it in raw
 * mode so Enter/arrow keys behave. Sent at most a few times per login.
 */
export const AGY_HANDSHAKE_REPLY = '\u001b[?2026;1$y\u001b[?2027;1$y\u001b[?1u\n';

/** Sequence agy uses to ask for the keyboard protocol. */
export const AGY_HANDSHAKE_QUERY = '\u001b[?u';

const ANSI_PATTERN =
  /\u001b(?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9])/g;
const GOOGLE_OAUTH_URL_PATTERN =
  /https:\/\/accounts\.google\.com\/[^\s"'<>]*?[?&]state=[A-Za-z0-9._~-]+/;
const URL_CHARS = new Set(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&\'()*+,;=%'.split(
    '',
  ),
);
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/**
 * Strip ANSI escape sequences and control characters from raw PTY
 * output, keeping newlines/tabs so screen text stays readable.
 */
export function sanitizeAgyOutput(text: string): string {
  return text
    .replace(ANSI_PATTERN, '')
    .split('')
    .filter((char) => char === '\n' || char === '\r' || char === '\t' || char.codePointAt(0)! >= 0x20)
    .join('');
}

/**
 * Find the Google OAuth sign-in URL on the current screen, or null.
 * The URL carries `state=` plus `client_id=` and `code_challenge=` —
 * all three must be present so a half-printed URL is never handed to
 * the user. When the TUI is past the login-method menu and mentions a
 * browser/code/paste step, any long https URL on screen is accepted as
 * a fallback (agy's wording varies by version).
 */
export function extractGoogleOAuthUrl(output: string): string | null {
  const compact = output.replace(/[\r\n\t ]+/g, '');
  const oauth = GOOGLE_OAUTH_URL_PATTERN.exec(compact);
  if (oauth?.[0] && oauth[0].includes('client_id=') && oauth[0].includes('code_challenge=')) {
    return oauth[0];
  }
  if (
    !output.toLowerCase().includes('select login method') &&
    (output.toLowerCase().includes('browser') ||
      output.toLowerCase().includes('visit') ||
      output.toLowerCase().includes('open') ||
      output.toLowerCase().includes('code') ||
      output.toLowerCase().includes('paste'))
  ) {
    // Whitespace-bounded, not compacted: on the compacted string the
    // words after the URL glue onto it ("…/callbackThen paste…") and the
    // link breaks. A wrapped non-OAuth URL truncates here, but the only
    // long URL agy prints is the OAuth one, which the primary path
    // above already handles (compaction re-joins its wrapped lines).
    const candidates = [...output.matchAll(/https:\/\/[^\s"']{20,}/g)]
      .map((match) => {
        let value = match[0];
        while (value.length > 0 && !URL_CHARS.has(value[value.length - 1]!)) {
          value = value.slice(0, -1);
        }
        return value;
      })
      .filter((value) => value.length >= 30 && value.includes('.'));
    return candidates.find((value) => value.includes('google')) ?? candidates[0] ?? null;
  }
  return null;
}

/** True once agy has finished signing in and shows its main screen. */
export function isAgySignedInScreen(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('for shortcuts') ||
    (lower.includes('antigravity cli') && lower.includes('google ai'))
  );
}

/**
 * Read the signed-in Google email off the main screen, or null. The
 * OAuth client id (`*.apps.googleusercontent.com`) is not an email.
 */
export function extractAgySignedInEmail(output: string): string | null {
  const emails = [...output.matchAll(EMAIL_PATTERN)].map((match) => match[0]);
  return (
    emails.find((email) => !email.toLowerCase().endsWith('.apps.googleusercontent.com')) ??
    null
  );
}
