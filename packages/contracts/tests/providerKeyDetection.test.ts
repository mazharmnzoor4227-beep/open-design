import { describe, expect, it } from 'vitest';
import {
  FREE_MODEL_BY_DETECTED_PROTOCOL,
  detectProviderFromApiKey,
  detectProviderResponse,
} from '../src/api/providerKeyDetection';

describe('detectProviderFromApiKey', () => {
  it('detects a Google Gemini key and picks the free flash model', () => {
    expect(detectProviderFromApiKey('AIzaSyD-abc123xyz')).toEqual({
      protocol: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com',
      providerLabel: 'Google Gemini',
      freeModel: 'gemini-3.8-flash',
      matchKind: 'google-key',
    });
  });

  it('detects a service-account-bound Google key (AQ.…)', () => {
    expect(
      detectProviderFromApiKey('AQ.Abcdefghijklmnopqrstuvwxyz0123456789')?.protocol,
    ).toBe('google');
  });

  it('detects an Anthropic key before the generic sk- rule', () => {
    expect(detectProviderFromApiKey('sk-ant-api03-abc')).toEqual({
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      providerLabel: 'Anthropic (Claude)',
      freeModel: 'claude-haiku-4-5',
      matchKind: 'sk-ant-',
    });
  });

  it('detects an OpenRouter key and routes it through the OpenAI protocol', () => {
    // Free default is a literally-free `:free` model: the free catalogue
    // rotates and deepseek has no free variant right now (live-checked
    // 2026-11-20), so the old deepseek pick would fail or charge.
    expect(detectProviderFromApiKey('sk-or-v1-abc123')).toEqual({
      protocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      providerLabel: 'OpenRouter',
      freeModel: 'nvidia/nemotron-3.5-lightning:free',
      matchKind: 'sk-or-',
    });
  });

  it('detects an xAI key', () => {
    expect(detectProviderFromApiKey('xai-abc123')).toEqual({
      protocol: 'openai',
      baseUrl: 'https://api.x.ai/v1',
      providerLabel: 'xAI',
      freeModel: 'grok-3-mini',
      matchKind: 'xai-',
    });
  });

  it('falls back to plain OpenAI for other sk- keys', () => {
    expect(detectProviderFromApiKey('sk-proj-abc123')?.protocol).toBe('openai');
    expect(detectProviderFromApiKey('sk-proj-abc123')?.baseUrl).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('returns null for blank and unknown key shapes', () => {
    expect(detectProviderFromApiKey('')).toBeNull();
    expect(detectProviderFromApiKey('   ')).toBeNull();
    expect(detectProviderFromApiKey('not-a-key')).toBeNull();
    expect(detectProviderFromApiKey('AQ.too-short')).toBeNull();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(detectProviderFromApiKey('  AIzaSyD-abc123xyz\n')?.protocol).toBe(
      'google',
    );
  });

  it('keeps the free-model map consistent with the detection results', () => {
    expect(FREE_MODEL_BY_DETECTED_PROTOCOL).toEqual({
      anthropic: 'claude-haiku-4-5',
      google: 'gemini-3.8-flash',
      openai: 'gpt-4o-mini',
    });
  });
});

describe('detectProviderResponse', () => {
  it('wraps a detection into the daemon response shape', () => {
    expect(detectProviderResponse('AIzaSyD-abc123xyz')).toEqual({
      detected: true,
      protocol: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com',
      freeModel: 'gemini-3.8-flash',
      providerLabel: 'Google Gemini',
    });
  });

  it('returns an undetected shape for unknown keys', () => {
    expect(detectProviderResponse('garbage')).toEqual({
      detected: false,
      protocol: null,
      baseUrl: null,
      freeModel: null,
      providerLabel: null,
    });
  });
});
