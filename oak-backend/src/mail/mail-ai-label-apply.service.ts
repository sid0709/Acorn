import { Injectable, Logger } from '@nestjs/common';
import { ImapClientService } from './imap/imap-client.service';
import type { MailAiLabelClassifyBatch } from './mail-ai-label-classify.service';
import {
  compactLlmError,
  logMailAiLabel,
  resolveCanonicalLabel,
  type MailAiLabelLoaded,
  type MailAiLabelResult,
} from './mail-ai-label.parse';
import { MailCacheService } from './mail-cache.service';
import type { MailCredentialsOk } from './mail-credentials.service';

export type MailAiLabelTarget = MailAiLabelLoaded & { label: string };

@Injectable()
export class MailAiLabelApplyService {
  private readonly logger = new Logger(MailAiLabelApplyService.name);

  constructor(
    private readonly imap: ImapClientService,
    private readonly cache: MailCacheService,
  ) {}

  collectTargets(
    batches: MailAiLabelClassifyBatch[],
    emails: MailAiLabelLoaded[],
    allowedLabels: string[],
    record: (id: string, result: MailAiLabelResult) => void,
  ): MailAiLabelTarget[] {
    const byId = new Map(emails.map((email) => [email.id, email]));
    const targets: MailAiLabelTarget[] = [];
    for (const batch of batches) {
      // A split batch can carry both answered and unanswered ids, so failures
      // are per id: only ids the model never answered count as errors.
      const missing = new Set(batch.missingIds || []);
      for (const [id, raw] of Object.entries(batch.labels)) {
        const email = byId.get(id);
        if (!email) continue;
        if (missing.has(id)) {
          record(id, {
            id,
            uid: email.uid,
            label: null,
            applied: false,
            reason: 'classification_error',
            error: batch.error || 'Model returned no classification',
          });
          continue;
        }
        const label = resolveCanonicalLabel(raw, allowedLabels);
        if (!label) {
          record(id, {
            id,
            uid: email.uid,
            label: null,
            applied: false,
            reason: 'no_match',
          });
          continue;
        }
        targets.push({ ...email, label });
      }
    }
    return targets;
  }

  async applyLabels(
    creds: MailCredentialsOk,
    targets: MailAiLabelTarget[],
    record: (id: string, result: MailAiLabelResult) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    const groups = new Map<string, MailAiLabelTarget[]>();
    for (const target of targets) {
      const key = `${target.mailbox}\0${target.label}`;
      const list = groups.get(key) || [];
      list.push(target);
      groups.set(key, list);
    }
    let writes = 0;
    for (const group of groups.values()) {
      if (signal?.aborted) break;
      const label = group[0]?.label;
      const mailbox = group[0]?.mailbox;
      if (!label || !mailbox) continue;
      logMailAiLabel(this.logger, 'gmail_write_start', {
        mailbox,
        label,
        uids: group.length,
      });
      try {
        await this.imap.addLabelsToMessages(
          creds.email,
          creds.password,
          group.map((row) => row.uid),
          [label],
          mailbox,
          { signal },
        );
        writes += 1;
        logMailAiLabel(this.logger, 'gmail_write_ok', {
          mailbox,
          label,
          uids: group.length,
        });
        await Promise.all(
          group.map((row) =>
            this.cache.updateMessageFlags(
              creds.applierName,
              row.uid,
              { gmailLabels: [...new Set([...row.gmailLabels, label])] },
              mailbox,
            ),
          ),
        );
        for (const row of group) {
          record(row.id, {
            id: row.id,
            uid: row.uid,
            label,
            applied: true,
            reason: 'applied',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logMailAiLabel(this.logger, 'gmail_write_error', {
          mailbox,
          label,
          uids: group.length,
          error: compactLlmError(message),
        });
        for (const row of group) {
          record(row.id, {
            id: row.id,
            uid: row.uid,
            label: null,
            applied: false,
            reason: 'gmail_error',
            error: message,
          });
        }
      }
    }
    return writes;
  }
}
