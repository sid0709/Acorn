import {
  MODEL_KEYS,
  keyHealth,
  type ModelKeyHealth,
  type ModelKeysStatus,
} from "@acorn/shared/model-keys";
import { ACORN_WEB_PATH, acornWebUrl } from "@acorn/shared/web-links";
import { Badge, Button, Glyph, HStack, type BadgeVariant } from "sid-ui";

import { DEFAULT_ACORN_WEB_URL } from "../auth/acorn-auth";

/** How each state of a key is shown: its badge and the word after the key's name. */
const HEALTH: Record<
  ModelKeyHealth,
  { variant: BadgeVariant; glyph: "check" | "alert" | "alertCircle" | "clock"; word: string }
> = {
  ok: { variant: "success", glyph: "check", word: "works" },
  missing: { variant: "warning", glyph: "alert", word: "not set" },
  invalid: { variant: "error", glyph: "alertCircle", word: "refused" },
  unknown: { variant: "neutral", glyph: "clock", word: "checking" },
};

/**
 * Always at the top of the sidebar: whether each model key of the profile is set and works. A key that is
 * missing or refused offers the profile page, where it is set.
 */
export function ModelKeyStatus({ status }: { status: ModelKeysStatus | null }) {
  const healths = MODEL_KEYS.map((key) => ({ key, health: keyHealth(status?.[key.id]) }));
  const needsProfile = healths.some(({ health }) => health === "missing" || health === "invalid");
  return (
    <HStack gap={2} align="center" wrap="wrap" className="acorn-key-status" aria-label="Model keys">
      {healths.map(({ key, health }) => (
        <Badge
          key={key.id}
          variant={HEALTH[health].variant}
          icon={<Glyph name={HEALTH[health].glyph} />}
          label={`${key.label} key ${HEALTH[health].word}`}
          aria-label={`${key.label} key ${HEALTH[health].word}: ${key.usedFor}`}
        />
      ))}
      {needsProfile ? (
        <Button
          size="sm"
          variant="ghost"
          label="Set keys"
          onClick={() =>
            void chrome.tabs.create({
              url: acornWebUrl(DEFAULT_ACORN_WEB_URL, ACORN_WEB_PATH.profile),
            })
          }
        />
      ) : null}
    </HStack>
  );
}
