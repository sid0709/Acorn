"use client";

import { useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  Glyph,
  Grid,
  HStack,
  Heading,
  IconButton,
  List,
  ListItem,
  Stack,
  StackItem,
  Text,
  TextArea,
  TextInput,
} from "sid-ui";
import {
  ROLE_SUMMARY_ROWS,
  entryPeriod,
  formatDuration,
  highlightsOf,
  monthsInRole,
  type CareerEntry,
} from "@/lib/workspace/profile";
import { EntryDates } from "./entry-dates";
import { PAIR_WIDTH } from "./form-layout";

const MARK_SIZE = 48;

const COPY = {
  role: {
    noun: "role",
    title: "Job title",
    org: "Company",
    blank: "New role",
    summary: "Highlights",
    summaryHint: "One achievement per line. Acorn uses these when it writes résumés and answers.",
  },
  education: {
    noun: "school",
    title: "Degree and field",
    org: "School",
    blank: "New school",
    summary: "Notes",
    summaryHint: "Honors, GPA, coursework, or activities, one per line.",
  },
} as const;

/** One role or school: a summary card that opens into its editor. */
export function TimelineEntry({
  entry,
  today,
  isNew,
  onChange,
  onRemove,
}: {
  entry: CareerEntry;
  today: Date;
  isNew: boolean;
  onChange: (patch: Partial<CareerEntry>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(isNew);
  const copy = COPY[entry.kind];
  const role = entry.kind === "role";
  const period = entryPeriod(entry);
  const months = role ? monthsInRole(entry, today) : 0;
  const highlights = highlightsOf(entry);
  const place = [entry.org, entry.location].filter(Boolean).join(" · ");

  return (
    <Card padding={5}>
      <Stack gap={4}>
        <HStack gap={4} vAlign="start">
          <Avatar name={entry.org || entry.title || copy.blank} size={MARK_SIZE} shape="rounded" />
          <StackItem size="fill">
            <Stack gap={1}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Heading level={3}>{entry.title || copy.blank}</Heading>
                {entry.current ? (
                  <Badge label={role ? "Current" : "In progress"} variant="success" />
                ) : null}
              </HStack>
              {place ? <Text color="secondary">{place}</Text> : null}
              <HStack gap={2} vAlign="center" wrap="wrap">
                {period ? (
                  <Text type="supporting" color="secondary">
                    {period}
                  </Text>
                ) : null}
                {months > 0 ? <Badge label={formatDuration(months)} variant="neutral" /> : null}
              </HStack>
            </Stack>
          </StackItem>
          <HStack gap={1}>
            <IconButton
              label={editing ? `Close ${copy.noun} editor` : `Edit ${copy.noun}`}
              icon={<Glyph name={editing ? "chevronUp" : "edit"} />}
              variant="ghost"
              size="sm"
              onClick={() => setEditing(!editing)}
            />
            <IconButton
              label={`Remove ${entry.title || copy.noun}`}
              icon={<Glyph name="trash" />}
              variant="ghost"
              size="sm"
              onClick={onRemove}
            />
          </HStack>
        </HStack>
        {editing ? (
          <Stack gap={4}>
            <Divider />
            <Grid columns={{ minWidth: PAIR_WIDTH * 2 }} gap={3}>
              <TextInput
                label={copy.title}
                value={entry.title}
                onChange={(title) => onChange({ title })}
              />
              <TextInput label={copy.org} value={entry.org} onChange={(org) => onChange({ org })} />
            </Grid>
            <TextInput
              label="Location"
              value={entry.location}
              onChange={(location) => onChange({ location })}
              placeholder="City, state — or Remote"
              isOptional
            />
            <EntryDates entry={entry} onChange={onChange} />
            <TextArea
              label={copy.summary}
              description={copy.summaryHint}
              value={entry.summary}
              onChange={(summary) => onChange({ summary })}
              rows={ROLE_SUMMARY_ROWS}
            />
            <HStack hAlign="end">
              <Button
                label="Done"
                variant="secondary"
                size="sm"
                onClick={() => setEditing(false)}
              />
            </HStack>
          </Stack>
        ) : highlights.length > 0 ? (
          <List listStyle="disc" density="compact">
            {highlights.map((line, index) => (
              <ListItem key={`${index}-${line.slice(0, 16)}`} label={line} />
            ))}
          </List>
        ) : null}
      </Stack>
    </Card>
  );
}
