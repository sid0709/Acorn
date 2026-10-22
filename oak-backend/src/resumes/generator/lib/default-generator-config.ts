/** Default resume-generator config when none is saved. */

const STEP_PURPOSES = ['summary', 'skills', 'experience'] as const;
const SECTION_LABEL: Record<(typeof STEP_PURPOSES)[number], string> = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
};

function defaultSchemaFor(purpose: string): string {
  switch (purpose) {
    case 'summary':
      return JSON.stringify(
        {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
          additionalProperties: false,
        },
        null,
        2,
      );
    case 'skills':
      return JSON.stringify(
        {
          type: 'object',
          properties: {
            skills: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  category: { type: 'string' },
                  items: { type: 'array', items: { type: 'string' } },
                },
                required: ['category', 'items'],
              },
            },
          },
          required: ['skills'],
          additionalProperties: false,
        },
        null,
        2,
      );
    case 'experience':
      return JSON.stringify(
        {
          type: 'object',
          properties: {
            experiences: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  company: { type: 'string' },
                  title: { type: 'string' },
                  period: { type: 'string' },
                  bullets: {
                    type: 'array',
                    minItems: 1,
                    items: { type: 'string', minLength: 1 },
                  },
                },
                required: ['company', 'title', 'bullets'],
              },
            },
          },
          required: ['experiences'],
          additionalProperties: false,
        },
        null,
        2,
      );
    default:
      return '{}';
  }
}

const DEFAULT_SYSTEM_INSTRUCTION = '';

const defaultTheme = (): {
  font: string;
  baseSize: number;
  nameSize: number;
  titleSize: number;
  accent: string;
  text: string;
  headerAlign: 'left' | 'center';
  paper: 'letter' | 'a4';
  margin: number;
} => ({
  font: 'Georgia',
  baseSize: 10.5,
  nameSize: 24,
  titleSize: 12,
  accent: '#1f3a5f',
  text: '#1a1a1a',
  headerAlign: 'center',
  paper: 'letter',
  margin: 0.6,
});

const finalStep = (purpose: (typeof STEP_PURPOSES)[number]) => ({
  id: `default-${purpose}`,
  purpose,
  kind: 'final' as const,
  name: `${SECTION_LABEL[purpose]} (final)`,
  prompt: '',
  schema: defaultSchemaFor(purpose),
});

export function defaultGeneratorConfig() {
  const theme = defaultTheme();
  return {
    schemaVersion: 4,
    provider: 'openai' as const,
    model: 'gpt-5-nano',
    reasoningEffort: 'low',
    dynamicCareerTitles: false,
    templateId: 'classic',
    theme,
    layout: [
      {
        id: 'summary',
        type: 'summary',
        title: 'Professional Summary',
        titleColor: theme.accent,
        titleSize: theme.titleSize,
        bodySize: theme.baseSize,
      },
      {
        id: 'skills',
        type: 'skills',
        title: 'Skills',
        titleColor: theme.accent,
        titleSize: theme.titleSize,
        bodySize: theme.baseSize,
      },
      {
        id: 'experience',
        type: 'experience',
        title: 'Experience',
        titleColor: theme.accent,
        titleSize: theme.titleSize,
        bodySize: theme.baseSize,
      },
      {
        id: 'education',
        type: 'education',
        title: 'Education',
        titleColor: theme.accent,
        titleSize: theme.titleSize,
        bodySize: theme.baseSize,
      },
    ],
    systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
    steps: STEP_PURPOSES.map((p) => finalStep(p)),
    coverage: {
      enabled: false,
      experienceRequirementThreshold: 4,
      aliases: {} as Record<string, string[]>,
    },
  };
}

export type GeneratorConfig = ReturnType<typeof defaultGeneratorConfig>;

function isValidJson(text: unknown): boolean {
  try {
    JSON.parse(String(text));
    return true;
  } catch {
    return false;
  }
}

/** Convert saved generator steps into the API request plan (parse JSON schemas). */
export function stepsToPlan(steps: unknown) {
  return (Array.isArray(steps) ? steps : []).map((raw, i) => {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<
      string,
      unknown
    >;
    const kind = s.kind;
    const schema = s.schema;
    return {
      index: i + 1,
      purpose: s.purpose,
      kind,
      name: s.name,
      prompt: s.prompt,
      ...(kind === 'final'
        ? {
            schema:
              typeof schema === 'string' && isValidJson(schema)
                ? (JSON.parse(schema) as unknown)
                : schema,
          }
        : {}),
    };
  });
}
