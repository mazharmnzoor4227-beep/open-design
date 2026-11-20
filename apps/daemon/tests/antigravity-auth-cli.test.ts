import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

interface StubResponse {
  status: number;
  body: unknown;
}

interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  setResponder: (fn: (req: CapturedRequest) => StubResponse) => void;
  close: () => Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  let responder: (req: CapturedRequest) => StubResponse = () => ({
    status: 404,
    body: { error: 'unexpected request' },
  });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const captured = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString('utf-8'),
      };
      requests.push(captured);
      const response = responder(captured);
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('stub server has no address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    setResponder: (fn) => {
      responder = fn;
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

async function runCli(
  args: string[],
  stub: StubServer,
  input?: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  // spawn (not execFile's `input` option): execFile writes piped input but
  // never ends the child's stdin in this Node, so a stdin read hangs.
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, CLI_SRC, ...args, '--daemon-url', stub.baseUrl],
      { cwd: DAEMON_ROOT, env, timeout: 15_000 },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ stdout, stderr, code });
    });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

const ACCOUNT_ID = 'ag-abcdef01';

function authSessionBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    session: {
      id: 'ag-auth-12345678',
      accountId: ACCOUNT_ID,
      status: 'awaiting-code',
      url: 'https://accounts.google.com/o/oauth2/auth?state=abc',
      email: null,
      error: null,
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-20T00:00:00.000Z',
      ...overrides,
    },
  };
}

describe('od antigravity auth CLI', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
    stub.setResponder(() => ({
      status: 404,
      body: { error: 'unexpected request' },
    }));
  });

  it('documents auth in `od antigravity help` with no terminal command', async () => {
    const result = await runCli(['antigravity', 'help'], stub);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('od antigravity auth start');
    expect(result.stdout).toContain('od antigravity auth code');
    expect(result.stdout).not.toContain('HOME=');
  });

  it('starts a sign-in and prints the Google URL', async () => {
    stub.setResponder((req) =>
      req.method === 'POST' &&
      req.url === `/api/antigravity/accounts/${ACCOUNT_ID}/auth/start`
        ? { status: 201, body: authSessionBody() }
        : { status: 404, body: { error: 'unexpected request' } },
    );

    const result = await runCli(
      ['antigravity', 'auth', 'start', ACCOUNT_ID, '--json'],
      stub,
    );
    expect(result.code).toBe(0);
    expect(stub.requests).toEqual([
      {
        method: 'POST',
        url: `/api/antigravity/accounts/${ACCOUNT_ID}/auth/start`,
        body: '',
      },
    ]);
    expect(JSON.parse(result.stdout)).toEqual(authSessionBody());
  });

  it('prints the sign-in URL in human output', async () => {
    stub.setResponder((req) =>
      req.method === 'POST' &&
      req.url === `/api/antigravity/accounts/${ACCOUNT_ID}/auth/start`
        ? { status: 201, body: authSessionBody() }
        : { status: 404, body: { error: 'unexpected request' } },
    );

    const result = await runCli(
      ['antigravity', 'auth', 'start', ACCOUNT_ID],
      stub,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('awaiting-code');
    expect(result.stdout).toContain(
      'https://accounts.google.com/o/oauth2/auth?state=abc',
    );
    expect(result.stdout).toContain(
      `od antigravity auth code ${ACCOUNT_ID}`,
    );
    expect(result.stdout).not.toContain('HOME=');
  });

  it('reads a sign-in status', async () => {
    stub.setResponder((req) =>
      req.method === 'GET' &&
      req.url === `/api/antigravity/accounts/${ACCOUNT_ID}/auth`
        ? {
            status: 200,
            body: authSessionBody({
              status: 'signed-in',
              url: null,
              email: 'mazhar@example.com',
            }),
          }
        : { status: 404, body: { error: 'unexpected request' } },
    );

    const result = await runCli(
      ['antigravity', 'auth', 'status', ACCOUNT_ID, '--json'],
      stub,
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      authSessionBody({
        status: 'signed-in',
        url: null,
        email: 'mazhar@example.com',
      }),
    );
  });

  it('submits the code from --code', async () => {
    stub.setResponder((req) =>
      req.method === 'POST' &&
      req.url === `/api/antigravity/accounts/${ACCOUNT_ID}/auth/code`
        ? { status: 200, body: authSessionBody({ status: 'completing' }) }
        : { status: 404, body: { error: 'unexpected request' } },
    );

    const result = await runCli(
      ['antigravity', 'auth', 'code', ACCOUNT_ID, '--code', '4/0CODE', '--json'],
      stub,
    );
    expect(result.code).toBe(0);
    expect(stub.requests).toEqual([
      {
        method: 'POST',
        url: `/api/antigravity/accounts/${ACCOUNT_ID}/auth/code`,
        body: JSON.stringify({ code: '4/0CODE' }),
      },
    ]);
    expect(JSON.parse(result.stdout)).toEqual(
      authSessionBody({ status: 'completing' }),
    );
  });

  it('submits the code piped on stdin', async () => {
    stub.setResponder((req) =>
      req.method === 'POST' &&
      req.url === `/api/antigravity/accounts/${ACCOUNT_ID}/auth/code`
        ? { status: 200, body: authSessionBody({ status: 'completing' }) }
        : { status: 404, body: { error: 'unexpected request' } },
    );

    const result = await runCli(
      ['antigravity', 'auth', 'code', ACCOUNT_ID, '--json'],
      stub,
      '4/0CODE\n',
    );
    expect(result.code).toBe(0);
    expect(stub.requests[0]?.body).toBe(JSON.stringify({ code: '4/0CODE' }));
  });

  it('cancels a sign-in', async () => {
    stub.setResponder((req) =>
      req.method === 'POST' &&
      req.url === `/api/antigravity/accounts/${ACCOUNT_ID}/auth/cancel`
        ? { status: 200, body: authSessionBody({ status: 'error' }) }
        : { status: 404, body: { error: 'unexpected request' } },
    );

    const result = await runCli(
      ['antigravity', 'auth', 'cancel', ACCOUNT_ID, '--json'],
      stub,
    );
    expect(result.code).toBe(0);
    expect(stub.requests).toEqual([
      {
        method: 'POST',
        url: `/api/antigravity/accounts/${ACCOUNT_ID}/auth/cancel`,
        body: '',
      },
    ]);
  });

  it('adds an account without printing a terminal command', async () => {
    stub.setResponder((req) =>
      req.method === 'POST' && req.url === '/api/antigravity/accounts'
        ? {
            status: 201,
            body: {
              account: {
                id: ACCOUNT_ID,
                label: 'Account 1',
                createdAt: '2026-11-20T00:00:00.000Z',
                active: false,
                quotaExhausted: false,
                quotaExhaustedUntil: null,
                homeDir: '/data/antigravity-accounts/ag-abcdef01',
                email: null,
              },
            },
          }
        : { status: 404, body: { error: 'unexpected request' } },
    );

    const result = await runCli(
      ['antigravity', 'accounts', 'add', '--label', 'Account 1'],
      stub,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `od antigravity auth start ${ACCOUNT_ID}`,
    );
    expect(result.stdout).not.toContain('HOME=');
  });

  it('rejects an unknown auth action', async () => {
    const result = await runCli(
      ['antigravity', 'auth', 'bogus', ACCOUNT_ID],
      stub,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('od antigravity auth');
  });
});
