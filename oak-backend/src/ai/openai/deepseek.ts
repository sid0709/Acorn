/**
 * DeepSeek V4 enables thinking by default. For JSON / high-throughput batch
 * work we disable it so responses stay fast and `content` is populated.
 */
export function deepseekThinkingBody(opts: {
  jsonMode?: boolean;
  jsonSchema?: unknown;
  thinking?: 'enabled' | 'disabled';
}): { thinking: { type: 'enabled' | 'disabled' } } {
  if (opts.thinking === 'enabled' || opts.thinking === 'disabled') {
    return { thinking: { type: opts.thinking } };
  }
  return { thinking: { type: 'disabled' } };
}

export function extractChatMessageContent(
  message:
    | {
        content?: string | null;
        reasoning_content?: string | null;
      }
    | null
    | undefined,
): string {
  return String(message?.content ?? '');
}
