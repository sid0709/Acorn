/**
 * The Now card's notice for how a run ended, when it is not the celebration: the page needs the person's
 * own hand (a CAPTCHA, a code sent to them, an ID number, a document, a sign-in), the run could not go on,
 * the job cannot be applied to online, the run is paused, or it is ready for the person to submit. Its
 * words come from the catalogue the notification cards read (user-messages.ts `describeRunEnd`), so the two
 * always say the same thing: a heading, what the page needs (in the agent's own plain words when it gave
 * them), what to do step by step, the buttons the card's own Continue and Run again do not already give,
 * and the raw text behind it under Details.
 */
import {
  NOTICE_ACTION,
  NOTICE_ACTION_LABEL,
  type DescribedMessage,
  type NoticeTone,
} from "@acorn/shared/user-messages";
import { Banner, Button, Glyph, HStack, Text, VStack, type BannerStatus } from "sid-ui";

import { runNoticeAction } from "./acorn-notice";

/** The banner's colour for each tone of the catalogue. */
const TONE_STATUS: Record<NoticeTone, BannerStatus> = {
  success: "success",
  accent: "info",
  neutral: "info",
  warning: "warning",
  danger: "error",
};

/** Buttons the Now card already shows under its board: not repeated in the notice. */
const CARD_ACTIONS: ReadonlySet<string> = new Set([NOTICE_ACTION.continue, NOTICE_ACTION.runAgain]);

export function AgentStopNotice({ said, tabId }: { said: DescribedMessage; tabId: number | null }) {
  const steps = [...new Set(said.steps)].filter((step) => step && step !== said.detail);
  const actions = said.actions.filter((action) => !CARD_ACTIONS.has(action));
  return (
    <Banner
      status={TONE_STATUS[said.tone]}
      icon={<Glyph name={said.glyph} />}
      title={said.title}
      description={said.detail}
    >
      <VStack gap={2}>
        {steps.length > 0 ? (
          <VStack gap={1}>
            <Text type="supporting" weight="semibold">
              What to do
            </Text>
            <ol className="agent-stop-steps">
              {steps.map((step) => (
                <li key={step}>
                  <Text type="supporting">{step}</Text>
                </li>
              ))}
            </ol>
          </VStack>
        ) : null}
        {actions.length > 0 ? (
          <HStack gap={2}>
            {actions.map((action, index) => (
              <Button
                key={action}
                size="sm"
                variant={index === 0 ? "primary" : "secondary"}
                label={NOTICE_ACTION_LABEL[action]}
                onClick={() => runNoticeAction(action, tabId ?? undefined)}
              />
            ))}
          </HStack>
        ) : null}
        {said.technical && said.technical !== said.title && said.technical !== said.detail ? (
          <details className="run-failure-details">
            <summary>Details</summary>
            <Text type="supporting">{said.technical}</Text>
          </details>
        ) : null}
      </VStack>
    </Banner>
  );
}
