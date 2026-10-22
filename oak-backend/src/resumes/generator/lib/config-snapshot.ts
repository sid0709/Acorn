/** Persistable generator request fields stored on resume_generations.config. */
export function configSnapshot(body: Record<string, unknown>) {
  return {
    provider: body.provider ?? null,
    model: body.model ?? null,
    reasoningEffort: body.reasoningEffort ?? null,
    dynamicCareerTitles: body.dynamicCareerTitles === true,
    templateId: body.templateId ?? null,
    template: body.template ?? null,
    theme: body.theme ?? null,
    layout: body.layout ?? null,
    systemInstruction: body.systemInstruction ?? null,
    steps: Array.isArray(body.steps) ? body.steps : [],
    coverage:
      body.coverage && typeof body.coverage === 'object'
        ? {
            settings:
              (body.coverage as { settings?: unknown }).settings ?? null,
          }
        : null,
  };
}
