"use client";

import { useState } from "react";
import {
  Button,
  Collapsible,
  HStack,
  SectionCard,
  Selector,
  Stack,
  Switch,
  Text,
  TextArea,
} from "sid-ui";
import {
  stepIssues,
  withFineTuneAdded,
  withStep,
  withStepMoved,
  withStepRemoved,
} from "@/lib/resume/steps";
import {
  DEFAULT_RESUME_SYSTEM_INSTRUCTION,
  RESUME_PROMPT_TOKENS,
  defaultResumeConfig,
  type ResumeGeneratorConfig,
} from "@acorn/shared/resume-config";
import {
  RESUME_PURPOSES,
  RESUME_SECTION_LABEL,
  type ResumePurpose,
} from "@acorn/shared/resume-templates";
import { StepCard } from "./step-card";

const SYSTEM_ROWS = 3;

const PURPOSE_OPTIONS = RESUME_PURPOSES.map((purpose) => ({
  value: purpose,
  label: RESUME_SECTION_LABEL[purpose],
}));

/**
 * What the model is told. The system instruction and the profile frame every call; each step then
 * writes or refines one section. Sections run side by side, a section's steps in order.
 */
export function PromptsCard({
  config,
  onChange,
}: {
  config: ResumeGeneratorConfig;
  onChange: (next: ResumeGeneratorConfig) => void;
}) {
  const [addPurpose, setAddPurpose] = useState<ResumePurpose>("summary");
  const issues = stepIssues(config);

  const reset = () => {
    const base = defaultResumeConfig();
    onChange({
      ...config,
      systemInstruction: base.systemInstruction,
      dynamicCareerTitles: base.dynamicCareerTitles,
      steps: base.steps,
    });
  };

  return (
    <SectionCard
      title="Prompts"
      description="Every section needs one final step. Add fine-tune steps to refine a draft before it."
    >
      <Stack gap={4}>
        <TextArea
          label="System instruction"
          value={config.systemInstruction}
          rows={SYSTEM_ROWS}
          placeholder={DEFAULT_RESUME_SYSTEM_INSTRUCTION}
          onChange={(systemInstruction) => onChange({ ...config, systemInstruction })}
        />
        <Switch
          label="Tailor job titles to the posting"
          description="Off keeps each title exactly as on your profile. On lets the model propose a concise title per role. Employers, dates, and order never change."
          value={config.dynamicCareerTitles}
          onChange={(dynamicCareerTitles) => onChange({ ...config, dynamicCareerTitles })}
        />
        <Collapsible
          defaultIsOpen={false}
          trigger={
            <Text type="supporting" color="secondary">
              Prompt tokens
            </Text>
          }
        >
          <Stack gap={1}>
            {RESUME_PROMPT_TOKENS.map((item) => (
              <Text key={item.token} type="supporting" color="secondary">
                {`${item.token}: ${item.description}`}
              </Text>
            ))}
            <Text type="supporting" color="secondary">
              A token that is not on this list stops the run before any model call.
            </Text>
          </Stack>
        </Collapsible>
        <Stack gap={3}>
          {config.steps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              position={index + 1}
              total={config.steps.length}
              issue={issues[step.id]}
              onChange={(patch) => onChange(withStep(config, step.id, patch))}
              onMove={(direction) => onChange(withStepMoved(config, step.id, direction))}
              onRemove={() => onChange(withStepRemoved(config, step.id))}
            />
          ))}
        </Stack>
        <HStack gap={2} vAlign="end" wrap="wrap" hAlign="between">
          <HStack gap={2} vAlign="end" wrap="wrap">
            <Selector
              label="Section"
              options={PURPOSE_OPTIONS}
              value={addPurpose}
              onChange={(value) => setAddPurpose(value as ResumePurpose)}
            />
            <Button
              label="Add fine-tune step"
              variant="secondary"
              onClick={() => onChange(withFineTuneAdded(config, addPurpose))}
            />
          </HStack>
          <Button label="Reset prompts" variant="ghost" onClick={reset} />
        </HStack>
      </Stack>
    </SectionCard>
  );
}
