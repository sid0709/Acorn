export const PROSE_ANSWERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          element_index: { type: 'number' },
          value: { type: 'string' },
        },
        required: ['element_index', 'value'],
      },
    },
  },
  required: ['answers'],
};

export const PROSE_ANSWERS_FORMAT = {
  type: 'json_schema',
  name: 'oak_prose_answers',
  strict: true,
  schema: PROSE_ANSWERS_SCHEMA,
};
