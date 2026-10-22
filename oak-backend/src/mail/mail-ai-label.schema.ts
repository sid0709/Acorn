/** OpenAI structured-output schema for mail AI label. DeepSeek uses json_object. */
export const MAIL_AI_LABEL_SCHEMA_NAME = 'mail_ai_label';

export const MAIL_AI_LABEL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label'],
        properties: {
          id: { type: 'string' },
          label: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;
