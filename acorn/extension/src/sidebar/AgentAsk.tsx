/**
 * The Now card while an agent Run waits on the person: the question, and one button per answer.
 * The run does nothing until one is pressed; the first answer is the one that carries on.
 */
import { Badge, Banner, Button, Glyph, VStack } from "sid-ui";

import type { RunProgress } from "@acorn/shared/run-types";

export function AgentAsk({
  ask,
  onAnswer,
}: {
  ask: NonNullable<RunProgress["ask"]>;
  onAnswer: (optionId: string) => void;
}) {
  return (
    <VStack gap={2}>
      <Badge variant="warning" label="Needs your answer" />
      <Banner
        status="warning"
        icon={<Glyph name="file" />}
        title="Which résumé should Acorn send?"
        description={ask.question}
      >
        <VStack gap={2}>
          {ask.options.map((option, index) => (
            <Button
              key={option.id}
              variant={index === 0 ? "primary" : "secondary"}
              label={option.label}
              width="100%"
              onClick={() => onAnswer(option.id)}
            />
          ))}
        </VStack>
      </Banner>
    </VStack>
  );
}
