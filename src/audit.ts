import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { VENV_STATE_DIR } from './layout.ts';
import { redactSecrets } from './rules.ts';

export interface AuditEntry {
  ts: string;
  tool: string;
  decision: 'allow' | 'deny' | 'error';
  summary: string;
  ruleId?: string;
  detail?: string;
}

export function auditDir(workDirAbs: string): string {
  return join(workDirAbs, VENV_STATE_DIR);
}

export function auditLogPath(workDirAbs: string): string {
  return join(auditDir(workDirAbs), 'audit.jsonl');
}

/** 追加一条审计记录；summary/detail 会脱敏。不上传。 */
export function appendAudit(workDirAbs: string, entry: AuditEntry): void {
  mkdirSync(auditDir(workDirAbs), { recursive: true });
  const line = JSON.stringify({
    ...entry,
    summary: redactSecrets(entry.summary).slice(0, 2000),
    detail: entry.detail != null ? redactSecrets(entry.detail).slice(0, 4000) : undefined,
  });
  appendFileSync(auditLogPath(workDirAbs), line + '\n', 'utf8');
}
