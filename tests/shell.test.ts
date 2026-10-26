import { describe, it, expect } from 'vitest';
import { parseRestrictedShell } from '../src/shell.ts';

describe('shell', () => {
  it('allows python and rejects pipes / powershell', () => {
    expect(parseRestrictedShell('python -c "print(1)"').ok).toBe(true);
    expect(parseRestrictedShell('dir | findstr x').ok).toBe(false);
    expect(parseRestrictedShell('powershell -enc QQ==').ok).toBe(false);
    expect(parseRestrictedShell('curl http://x').ok).toBe(false);
  });
});
