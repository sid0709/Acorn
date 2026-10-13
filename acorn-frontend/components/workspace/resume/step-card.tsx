"use client";

import {
  Banner,
  Button,
  Card,
  CheckboxInput,
  Collapsible,
  Glyph,
  HStack,
  IconButton,
  SegmentedControl,
  SegmentedControlItem,
  Selector,
  Stack,
  Text,
  TextArea,
  TextInput,
} from "sid-ui";
import { withToken } from "@/lib/resume/steps";
import {
  RESUME_PROMPT_TOKENS,
  defaultSchemaFor,
  type ResumeGenStep,
  type ResumeStepKind,
} from "@acorn/shared/resume-config";
import {
  RESUME_PURPOSES,
  RESUME_SECTION_LABEL,
  type ResumePurpose,
} from "@acorn/shared/resume-templates";

const STEP_NAME_MAX = 60;
const PROMPT_ROWS = 6;
const SCHEMA_ROWS = 10;

const PURPOSE_OPTIONS = RESUME_PURPOSES.map((purpose) => ({
  value: purpose,
  label: RESUME_SECTION_LABEL[purpose],
}));

/** One model call: which section it writes, whether it refines a draft or returns the section, and its prompt. */
export function StepCard({
  step,
  position,
  total,
  issue,
  onChange,
  onMove,
  onRemove,
}: {
  step: ResumeGenStep;
  position: number;
  total: number;
  issue?: string;
  onChange: (patch: Partial<ResumeGenStep>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const isFinal = step.kind === "final";
  const sectionLabel = RESUME_SECTION_LABEL[step.purpose];

  const setKind = (kind: ResumeStepKind) => {
    if (kind === step.kind) return;
    onChange({
      kind,
      schema:
        kind === "final" && !step.schema.trim() ? defaultSchemaFor(step.purpose) : step.schema,
    });
  };

  const setPurpose = (purpose: ResumePurpose) =>
    onChange({
      purpose,
      schema:
        step.schema === defaultSchemaFor(step.purpose) ? defaultSchemaFor(purpose) : step.schema,
    });

  return (
    <Card padding={4}>
      <Stack gap={3}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text weight="semibold" color="secondary">{`${position}.`}</Text>
          <TextInput
            label="Step name"
            isLabelHidden
            value={step.name}
            placeholder={`Step ${position}`}
            onChange={(name) => onChange({ name: name.slice(0, STEP_NAME_MAX) })}
          />
          <HStack gap={1}>
            <IconButton
              label={`Run ${step.name || `step ${position}`} earlier`}
              icon={<Glyph name="arrowUp" />}
              variant="ghost"
              size="sm"
              isDisabled={position === 1}
              onClick={() => onMove(-1)}
            />
            <IconButton
              label={`Run ${step.name || `step ${position}`} later`}
              icon={<Glyph name="arrowDown" />}
              variant="ghost"
              size="sm"
              isDisabled={position === total}
              onClick={() => onMove(1)}
            />
            <IconButton
              label={isFinal ? "Each section needs its final step" : "Remove step"}
              icon={<Glyph name="trash" />}
              variant="ghost"
              size="sm"
              isDisabled={isFinal}
              onClick={onRemove}
            />
          </HStack>
        </HStack>
        <HStack gap={3} vAlign="end" wrap="wrap">
          <Selector
            label="Writes"
            options={PURPOSE_OPTIONS}
            value={step.purpose}
            onChange={(value) => setPurpose(value as ResumePurpose)}
          />
          <SegmentedControl
            label="Step type"
            value={step.kind}
            onChange={(value) => setKind(value as ResumeStepKind)}
          >
            <SegmentedControlItem value="fine-tune" label="Fine-tune" />
            <SegmentedControlItem value="final" label="Final" />
          </SegmentedControl>
        </HStack>
        {issue ? <Banner status="error" title={issue} /> : null}
        <TextArea
          label="Prompt"
          value={step.prompt}
          rows={PROMPT_ROWS}
          placeholder={
            isFinal
              ? `Blank runs the default ${sectionLabel.toLowerCase()} prompt.`
              : "What should this step add to the draft?"
          }
          onChange={(prompt) => onChange({ prompt })}
        />
        <HStack gap={1} wrap="wrap" vAlign="center">
          <Text type="supporting" color="secondary">
            Insert
          </Text>
          {RESUME_PROMPT_TOKENS.map((item) => (
            <Button
              key={item.token}
              label={item.token}
              tooltip={item.description}
              variant="ghost"
              size="sm"
              onClick={() => onChange({ prompt: withToken(step.prompt, item.token) })}
            />
          ))}
        </HStack>
        {isFinal ? (
          <Collapsible
            defaultIsOpen={false}
            trigger={
              <Text type="supporting" color="secondary">
                Output schema
              </Text>
            }
          >
            <Stack gap={2}>
              <TextArea
                label="Output schema"
                isLabelHidden
                value={step.schema}
                rows={SCHEMA_ROWS}
                onChange={(schema) => onChange({ schema })}
              />
              <HStack hAlign="between" vAlign="center" wrap="wrap">
                <Text type="supporting" color="secondary">
                  JSON the model must return. Blank uses the default.
                </Text>
                <Button
                  label={`Reset to ${sectionLabel} default`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ schema: defaultSchemaFor(step.purpose) })}
                />
              </HStack>
            </Stack>
          </Collapsible>
        ) : (
          <CheckboxInput
            label="Skip for catalog jobs"
            description="Catalog jobs arrive with their skills fetched. Reference them in a later prompt with {job_skills}. A pasted posting always runs this step."
            value={Boolean(step.skipForStructuredJobs)}
            onChange={(skipForStructuredJobs) => onChange({ skipForStructuredJobs })}
          />
        )}
      </Stack>
    </Card>
  );
}
