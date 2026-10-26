import { describe, it, expect } from 'vitest';
import { hostMatchesBlacklist, redactSecrets, scanForHighRisk } from '../src/rules.ts';

describe('rules', () => {
  it('detects API key style secrets', () => {
    const hit = scanForHighRisk({ tool: 'pe_write', text: 'token sk-abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(hit?.id).toBe('secret.openai_sk');
  });

  it('detects path escape / System32', () => {
    const hit = scanForHighRisk({ tool: 'pe_shell', text: 'type C:\\Windows\\System32\\drivers\\etc\\hosts' });
    expect(hit?.id).toBe('escape.system32');
  });

  it('matches network blacklist hosts', () => {
    expect(hostMatchesBlacklist('evil.example.com', ['.example.com'])).toBe(true);
    expect(hostMatchesBlacklist('ok.dev', ['.example.com'])).toBe(false);
    const hit = scanForHighRisk({
      tool: 'pe_run_python',
      text: 'https://evil.example.com/x',
      networkBlacklist: ['.example.com'],
    });
    expect(hit?.id).toBe('network.blacklist');
  });

  it('redacts secrets', () => {
    expect(redactSecrets('sk-abcdefghijklmnopqrstuvwxyz0123456789')).toContain('sk-***');
  });
});
