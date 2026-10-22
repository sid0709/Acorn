export const IDENTITY_CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          element_index: { type: 'number' },
          kind: {
            type: 'string',
            enum: ['application_ai', 'workplace_ai', 'other'],
          },
        },
        required: ['element_index', 'kind'],
      },
    },
  },
  required: ['classifications'],
};

export const IDENTITY_CLASSIFY_FORMAT = {
  type: 'json_schema',
  name: 'oak_identity_classify',
  strict: true,
  schema: IDENTITY_CLASSIFY_SCHEMA,
};
