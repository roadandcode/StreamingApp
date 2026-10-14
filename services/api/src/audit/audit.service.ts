import { Injectable } from '@nestjs/common';
import type { Executor } from '../database/database.types';
import { auditLogs } from '../database/schema';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes `audit_logs` rows. Callers pass the transaction that performs the audited change so the
 * record and the change commit (or roll back) together. Never put secrets or tokens in metadata.
 */
@Injectable()
export class AuditService {
  async record(executor: Executor, entry: AuditEntry): Promise<void> {
    await executor.insert(auditLogs).values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
    });
  }
}
