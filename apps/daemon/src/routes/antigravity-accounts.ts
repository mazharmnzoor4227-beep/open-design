// Antigravity multi-account routes.
//
// Stock `agy` holds one Google login at a time. The fork keeps one
// credential home per connected account under the daemon data root (see
// `services/antigravity-accounts.ts`); runs spawn agy with HOME pointed
// at the active account's home. These endpoints manage the registry —
// list, add, activate, remove, clear a quota flag — and are the same
// endpoints the Settings UI and the `od antigravity accounts …` CLI call.
// No endpoint ever returns a token: credentials live in agy's own files
// inside the account home.

import type { Express } from 'express';
import type { AntigravityAccountsResponse } from '@open-design/contracts/api/antigravityAccounts';
import {
  clearAntigravityAccountQuota,
  createAntigravityAccount,
  isValidAntigravityAccountId,
  listAntigravityAccounts,
  removeAntigravityAccount,
  setActiveAntigravityAccount,
} from '../services/antigravity-accounts.js';

export interface RegisterAntigravityAccountsRoutesDeps {
  paths: {
    RUNTIME_DATA_DIR: string;
  };
}

function errorMessage(err: unknown): string {
  return String((err as { message?: unknown } | null)?.message || err);
}

export function registerAntigravityAccountsRoutes(
  app: Express,
  deps: RegisterAntigravityAccountsRoutesDeps,
): void {
  const { RUNTIME_DATA_DIR } = deps.paths;

  const listResponse = (): AntigravityAccountsResponse => {
    const accounts = listAntigravityAccounts(RUNTIME_DATA_DIR);
    return {
      accounts,
      activeAccountId: accounts.find((account) => account.active)?.id ?? null,
    };
  };

  app.get('/api/antigravity/accounts', (_req, res) => {
    res.json(listResponse());
  });

  app.post('/api/antigravity/accounts', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const label = typeof body.label === 'string' ? body.label : '';
    if (!label.trim()) {
      return res.status(400).json({ error: 'label is required' });
    }
    try {
      const account = createAntigravityAccount(RUNTIME_DATA_DIR, label);
      return res.status(201).json({ account });
    } catch (err) {
      return res.status(400).json({ error: errorMessage(err) });
    }
  });

  app.post('/api/antigravity/accounts/:id/activate', (req, res) => {
    const id = req.params.id ?? '';
    if (!isValidAntigravityAccountId(id)) {
      return res.status(400).json({ error: 'invalid account id' });
    }
    const account = setActiveAntigravityAccount(RUNTIME_DATA_DIR, id);
    if (!account) {
      return res.status(404).json({ error: 'account not found' });
    }
    return res.json({ account });
  });

  app.post('/api/antigravity/accounts/:id/clear-quota', (req, res) => {
    const id = req.params.id ?? '';
    if (!isValidAntigravityAccountId(id)) {
      return res.status(400).json({ error: 'invalid account id' });
    }
    const account = clearAntigravityAccountQuota(RUNTIME_DATA_DIR, id);
    if (!account) {
      return res.status(404).json({ error: 'account not found' });
    }
    return res.json({ account });
  });

  app.delete('/api/antigravity/accounts/:id', (req, res) => {
    const id = req.params.id ?? '';
    if (!isValidAntigravityAccountId(id)) {
      return res.status(400).json({ error: 'invalid account id' });
    }
    const removed = removeAntigravityAccount(RUNTIME_DATA_DIR, id);
    if (!removed) {
      return res.status(404).json({ error: 'account not found' });
    }
    return res.status(204).send();
  });
}
