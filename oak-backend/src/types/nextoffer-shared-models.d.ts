declare module '@nextoffer/shared/models' {
  export const DEEPSEEK_MODELS: string[];
  export const DEEPSEEK_DEFAULT_MODEL: string;
  export function isDeepSeekModel(id: string): boolean;
  export function normalizeDeepSeekModel(model: string): string;
  export function listOpenAiModels(
    apiKey: string,
  ): Promise<Array<{ id: string; created?: number; ownedBy?: string }>>;
}
