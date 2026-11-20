import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveLocalLlamaProvider } from '../../src/integrations/provider-models.js';
import { buildOpenCodeByokProviderConfig } from '../../src/runtimes/byok-opencode.js';

// Fork: the no-key default provider. The daemon falls back to the local
// llama-server (LFM3) when a byok-opencode run carries no usable provider,
// so a fresh "Continue without a key" session runs instead of failing with
// BYOK_PROVIDER_REQUIRED.

interface StubServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startModelStub(models: { id: string }[]): Promise<StubServer> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: models }));
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, '127.0.0.1', resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('stub server has no address');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

describe('resolveLocalLlamaProvider', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startModelStub([{ id: 'lfm3-1.7b' }, { id: 'other-model' }]);
  });

  afterAll(async () => {
    await stub.close();
  });

  it('returns the first model the local server reports', async () => {
    const resolved = await resolveLocalLlamaProvider([stub.baseUrl]);
    expect(resolved).toEqual({ baseUrl: stub.baseUrl, model: 'lfm3-1.7b' });
  });

  it('skips a dead candidate and uses the next one that answers', async () => {
    const resolved = await resolveLocalLlamaProvider([
      'http://127.0.0.1:9/v1',
      stub.baseUrl,
    ]);
    expect(resolved).toEqual({ baseUrl: stub.baseUrl, model: 'lfm3-1.7b' });
  });

  it('returns null when no candidate answers', async () => {
    await expect(
      resolveLocalLlamaProvider(['http://127.0.0.1:9/v1']),
    ).resolves.toBeNull();
  });

  it('returns null when the server reports no models', async () => {
    const empty = await startModelStub([]);
    try {
      await expect(
        resolveLocalLlamaProvider([empty.baseUrl]),
      ).resolves.toBeNull();
    } finally {
      await empty.close();
    }
  });

  it('builds a usable BYOK provider config from the resolved local server', async () => {
    const resolved = await resolveLocalLlamaProvider([stub.baseUrl]);
    expect(resolved).not.toBeNull();
    const provider = buildOpenCodeByokProviderConfig(
      {
        protocol: 'openai',
        apiKey: '',
        baseUrl: resolved!.baseUrl,
        model: resolved!.model,
        requiresApiKey: false,
      },
      resolved!.model,
    );
    expect(provider).not.toBeNull();
  });
});
