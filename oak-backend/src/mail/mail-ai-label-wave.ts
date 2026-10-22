import type { ProfileLlmAuth } from '../ai/auth/profile-llm-auth.service';
import type { MailAiLabelApplyService } from './mail-ai-label-apply.service';
import type {
  MailAiLabelCatalogItem,
  MailAiLabelClassifyBatch,
  MailAiLabelClassifyItem,
  MailAiLabelClassifyService,
} from './mail-ai-label-classify.service';
import type {
  MailAiLabelLoaded,
  MailAiLabelResult,
} from './mail-ai-label.parse';
import type { MailCredentialsOk } from './mail-credentials.service';

/** Classify one wave batch, then STORE matching custom labels on Gmail. */
export async function classifyThenApplyBatch(input: {
  classify: MailAiLabelClassifyService;
  apply: MailAiLabelApplyService;
  auth: ProfileLlmAuth;
  catalog: MailAiLabelCatalogItem[];
  emails: MailAiLabelLoaded[];
  batch: MailAiLabelClassifyItem[];
  allowedLabels: string[];
  creds: MailCredentialsOk;
  record: (id: string, result: MailAiLabelResult) => void;
  signal?: AbortSignal;
}): Promise<{
  result: MailAiLabelClassifyBatch;
  writes: number;
  classifyMs: number;
  writeMs: number;
}> {
  const tClassify = Date.now();
  const result = await input.classify.classifyBatch({
    auth: input.auth,
    catalog: input.catalog,
    emails: input.batch,
    signal: input.signal,
  });
  const classifyMs = Date.now() - tClassify;

  const tWrite = Date.now();
  const writes = await input.apply.applyLabels(
    input.creds,
    input.apply.collectTargets(
      [result],
      input.emails,
      input.allowedLabels,
      input.record,
    ),
    input.record,
    input.signal,
  );
  return {
    result,
    writes,
    classifyMs,
    writeMs: Date.now() - tWrite,
  };
}
