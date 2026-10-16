/**
 * The Now card's notice when the agent ended a run itself. Either the page needs the person's
 * own hand (a CAPTCHA, a code sent to them, an ID number, a document, a sign-in) or the agent
 * could not go on. It says which in a heading, what the page needs in the agent's own plain
 * words, and what to do, step by step, ending with the button that picks the run up again.
 */
import { AGENT_STOP_REASON, type AgentStopReason } from "@acorn/shared/agent-contract";
import { RUN_FAILURE_REASON, type RunFailure } from "@acorn/shared/run-types";
import { Badge, Banner, Glyph, Text, VStack, type GlyphName } from "sid-ui";

type StopCopy = { heading: string; glyph: GlyphName };

/** The heading and icon for each reason the agent gives. */
const STOP_COPY: Record<AgentStopReason, StopCopy> = {
  [AGENT_STOP_REASON.captcha]: { heading: "Show the page you're not a robot", glyph: "lock" },
  [AGENT_STOP_REASON.verification]: { heading: "Enter the code sent to you", glyph: "mail" },
  [AGENT_STOP_REASON.verificationLink]: { heading: "Open the link sent to you", glyph: "mail" },
  [AGENT_STOP_REASON.identity]: { heading: "Add your ID details", glyph: "creditCard" },
  [AGENT_STOP_REASON.document]: { heading: "Upload a document", glyph: "upload" },
  [AGENT_STOP_REASON.signIn]: { heading: "Sign in to continue", glyph: "user" },
  [AGENT_STOP_REASON.pageProblem]: { heading: "The page won't let Acorn go on", glyph: "info" },
  [AGENT_STOP_REASON.other]: { heading: "Acorn needs you here", glyph: "user" },
  [AGENT_STOP_REASON.noChange]: { heading: "The page stopped responding", glyph: "refresh" },
  [AGENT_STOP_REASON.stepLimit]: { heading: "This application ran too long", glyph: "clock" },
  [AGENT_STOP_REASON.resumeChoice]: { heading: "Choose your résumé", glyph: "file" },
};

/** The last step of each kind of notice: what the buttons below it do. */
const NEEDS_YOU_LAST_STEP = "Press Continue, and Acorn picks up where it stopped.";
const COULD_NOT_FINISH_LAST_STEP =
  "Press Continue to try again from here, or Run again to start over.";

export function AgentStopNotice({ failure }: { failure: RunFailure }) {
  const stop = failure.agentStop;
  if (!stop) return null;
  const needsYou = failure.reason === RUN_FAILURE_REASON.waitedForPerson;
  const copy =
    STOP_COPY[stop.reason as AgentStopReason] ??
    STOP_COPY[needsYou ? AGENT_STOP_REASON.other : AGENT_STOP_REASON.pageProblem];
  const heading =
    !needsYou && stop.reason === AGENT_STOP_REASON.other
      ? "Acorn couldn't finish this page"
      : copy.heading;
  const steps = [stop.action, needsYou ? NEEDS_YOU_LAST_STEP : COULD_NOT_FINISH_LAST_STEP].filter(
    Boolean,
  );
  return (
    <VStack gap={2}>
      <Badge
        variant={needsYou ? "warning" : "error"}
        label={needsYou ? "Needs you" : "Couldn't finish"}
      />
      <Banner
        status={needsYou ? "warning" : "error"}
        icon={<Glyph name={copy.glyph} />}
        title={heading}
        description={stop.problem}
      >
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
      </Banner>
    </VStack>
  );
}
