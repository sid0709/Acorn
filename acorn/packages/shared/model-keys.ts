/**
 * The model keys of the person's profile, as the extension shows them at the top of the sidebar: set or not,
 * and whether the provider takes them. acorn-backend asks the providers (acornapi/keys.go); the keys
 * themselves never reach the extension.
 */

/** acorn-backend route: whether each model key of the signed-in profile is set and works. */
export const ACORN_PROFILE_KEYS_API = "/acorn/profile/keys";

/** One key: set or not, and whether its provider takes it (null when the provider could not be asked). */
export interface ModelKeyState {
  set: boolean;
  valid: boolean | null;
}

export interface ModelKeysStatus {
  openrouter: ModelKeyState;
  openai: ModelKeyState;
}

/** The keys, in the order shown, with what each is for. */
export const MODEL_KEYS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    usedFor: "GPT-6 Luna plans each page; Jev decides about text",
  },
  { id: "openai", label: "OpenAI", usedFor: "Decisions about screenshots" },
] as const satisfies readonly { id: keyof ModelKeysStatus; label: string; usedFor: string }[];

export type ModelKeyHealth = "ok" | "missing" | "invalid" | "unknown";

/** What a key's state means for the person. */
export function keyHealth(state: ModelKeyState | undefined): ModelKeyHealth {
  if (!state) return "unknown";
  if (!state.set) return "missing";
  if (state.valid === true) return "ok";
  if (state.valid === false) return "invalid";
  return "unknown";
}
