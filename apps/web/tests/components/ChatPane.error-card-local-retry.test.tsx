// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPane } from '../../src/components/ChatPane';
import type { AppConfig, ChatMessage } from '../../src/types';

const translate = (key: string) => key;
vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: translate }),
  useT: () => translate,
}));
vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Fork: a failed Antigravity run offers the local retry ("Use local model
// instead") instead of the paid Cloud switch. Other agents keep the
// upstream Cloud recovery (OPEND-3205 pins that flow).
function renderFailure(agentId: string, extra: Partial<ComponentProps<typeof ChatPane>> = {}) {
  const failed: ChatMessage = {
    id: 'local-retry-failed', role: 'assistant', content: '', agentId,
    runId: 'local-retry-run', runStatus: 'failed', createdAt: 1000, endedAt: 2000,
    events: [{ kind: 'status', label: 'error', code: 'AMR_TIER_UPGRADE_REQUIRED', detail: 'Plan unavailable' }],
  };
  render(<ChatPane
    messages={[{ id: 'user', role: 'user', content: 'Create a page', createdAt: 0 }, failed]}
    streaming={false} error={null} projectId="local-retry-project" projectFiles={[]}
    config={{ mode: 'daemon', agentId, agentCliEnv: {} } as AppConfig}
    onEnsureProject={async () => 'local-retry-project'} onSend={vi.fn()} onStop={vi.fn()}
    onRetry={vi.fn()} onSwitchToAmrAndRetry={vi.fn()}
    conversations={[{ id: 'local-retry-conversation', projectId: 'local-retry-project', title: 'Current', createdAt: 0, updatedAt: 0 }]}
    activeConversationId="local-retry-conversation" onSelectConversation={vi.fn()} onDeleteConversation={vi.fn()}
    {...extra}
  />);
  return screen.getByTestId('chat-run-error-card');
}

describe('fork: error card local retry', () => {
  it('shows the local retry (not the Cloud switch) for a failed Antigravity run', () => {
    const onSwitchToLocalAndRetry = vi.fn();
    const card = renderFailure('antigravity', { onSwitchToLocalAndRetry });
    expect(within(card).getByRole('button', { name: 'settings.byokUseLocal' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'chat.amrCard.switchCta' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'settings.byokUseLocal' }));
    expect(onSwitchToLocalAndRetry).toHaveBeenCalledOnce();
    const firstCall = onSwitchToLocalAndRetry.mock.calls[0];
    expect(firstCall?.[0]).toMatchObject({ id: 'local-retry-failed' });
  });

  it('falls back to the Cloud switch when the local retry is not wired', () => {
    const card = renderFailure('antigravity');
    expect(within(card).getByRole('button', { name: 'chat.amrCard.switchCta' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'settings.byokUseLocal' })).toBeNull();
  });

  it('keeps the Cloud switch for other local agents (OPEND-3205)', () => {
    const card = renderFailure('codex', { onSwitchToLocalAndRetry: vi.fn() });
    expect(within(card).getByRole('button', { name: 'chat.amrCard.switchCta' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'settings.byokUseLocal' })).toBeNull();
  });

  it('keeps the Cloud switch for a failure already on byok-opencode', () => {
    const card = renderFailure('byok-opencode', { onSwitchToLocalAndRetry: vi.fn() });
    expect(within(card).getByRole('button', { name: 'chat.amrCard.switchCta' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'settings.byokUseLocal' })).toBeNull();
  });
});
