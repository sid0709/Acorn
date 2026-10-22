const ACTION_TYPES = [
  'fill',
  'upload',
  'resume_upload',
  'select_radio',
  'wait',
  'validate',
  'pause_for_review',
  'forbidden',
] as const;

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableNumberArray = {
  type: ['array', 'null'],
  items: { type: 'number' },
};

const planActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: [...ACTION_TYPES] },
    element_index: nullableNumber,
    element_indexes: nullableNumberArray,
    expected_label: nullableString,
    expected_role: nullableString,
    value: nullableString,
    file: nullableString,
    reason: nullableString,
    ms: nullableNumber,
  },
  required: [
    'action',
    'element_index',
    'element_indexes',
    'expected_label',
    'expected_role',
    'value',
    'file',
    'reason',
    'ms',
  ],
};

export const ACTION_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    goal: { type: 'string' },
    actions: {
      type: 'array',
      items: planActionSchema,
    },
    forbidden_actions: {
      type: 'array',
      items: planActionSchema,
    },
    validation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        required_element_indexes: {
          type: 'array',
          items: { type: 'number' },
        },
        stop_before_submit: { type: 'boolean' },
      },
      required: ['required_element_indexes', 'stop_before_submit'],
    },
    unresolved_items: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'goal',
    'actions',
    'forbidden_actions',
    'validation',
    'unresolved_items',
  ],
};

export const ACTION_PLAN_FORMAT = {
  type: 'json_schema',
  name: 'oak_action_plan',
  strict: true,
  schema: ACTION_PLAN_SCHEMA,
};

export const MATCH_OPTION_FORMAT = {
  type: 'json_schema',
  name: 'oak_option_match',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      matched_option: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['matched_option', 'confidence', 'reason'],
  },
};

/** JSON-schema enum stays bounded so large country lists still validate. */
const MATCH_OPTION_ENUM_MAX = 64;

/** Constrain matched_option to the live listed strings. */
export function matchOptionFormat(options: string[]): Record<string, unknown> {
  const listed = [
    ...new Set(options.map((item) => item.trim()).filter(Boolean)),
  ];
  const useEnum = listed.length > 0 && listed.length <= MATCH_OPTION_ENUM_MAX;
  return {
    type: 'json_schema',
    name: 'oak_option_match',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        matched_option: listed.length
          ? useEnum
            ? { type: 'string', enum: listed }
            : { type: 'string' }
          : { type: ['string', 'null'] },
        confidence: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['matched_option', 'confidence', 'reason'],
    },
  };
}

export function validatePlanShape(
  plan: unknown,
): asserts plan is Record<string, unknown> {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Plan must be a JSON object');
  }
  const p = plan as Record<string, unknown>;
  for (const key of [
    'goal',
    'actions',
    'forbidden_actions',
    'validation',
    'unresolved_items',
  ]) {
    if (!(key in p)) {
      throw new Error(`Plan missing required field: ${key}`);
    }
  }
  if (!Array.isArray(p.actions) || !Array.isArray(p.forbidden_actions)) {
    throw new Error('Plan actions and forbidden_actions must be arrays');
  }
  if (!p.validation || typeof p.validation !== 'object') {
    throw new Error('Plan validation must be an object');
  }
  const validation = p.validation as Record<string, unknown>;
  if (!Array.isArray(validation.required_element_indexes)) {
    throw new Error('validation.required_element_indexes must be an array');
  }
  if (typeof validation.stop_before_submit !== 'boolean') {
    throw new Error('validation.stop_before_submit must be a boolean');
  }
  if (!Array.isArray(p.unresolved_items)) {
    throw new Error('unresolved_items must be an array');
  }
}
