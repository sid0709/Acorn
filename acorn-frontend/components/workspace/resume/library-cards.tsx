"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CheckboxInput,
  Glyph,
  Grid,
  HStack,
  Heading,
  IconButton,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Text,
  formatBytes,
} from "sid-ui";
import type { ResumeLibraryRow } from "@acorn/shared/resume-library";
import { formatWhen } from "@/lib/workspace/model";

const CARD_MIN_WIDTH = 280;
const CARD_COLUMNS = 3;

/** One stack and the same file in each format it was uploaded in. */
export type LibraryGroup = { key: string; label: string; rows: ResumeLibraryRow[] };

/** Files with the same title are one stack in several formats; PDF is listed first. */
export function groupByStack(rows: ResumeLibraryRow[]): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  for (const row of rows) {
    const label = row.title || row.fileName;
    const group = groups.get(label) ?? { key: label, label, rows: [] };
    group.rows.push(row);
    groups.set(label, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => a.format.localeCompare(b.format)),
  }));
}

/** The file a card shows first: the default one if it has one. */
function firstShown(group: LibraryGroup) {
  return group.rows.find((row) => row.isPrimary) ?? group.rows[0];
}

/** A stack's label is the role, not a file name; the secondary line carries format, size, and date. */
export function LibraryCards({
  groups,
  selected,
  selectable,
  busy,
  empty,
  onSelect,
  onMakeDefault,
  onRemove,
  onShowSkills,
}: {
  groups: LibraryGroup[];
  selected: string[];
  selectable: boolean;
  busy: boolean;
  empty: string;
  onSelect: (ids: string[]) => void;
  onMakeDefault: (row: ResumeLibraryRow) => void;
  onRemove: (row: ResumeLibraryRow) => void;
  onShowSkills: (row: ResumeLibraryRow) => void;
}) {
  const [shown, setShown] = useState<Record<string, string>>({});
  if (groups.length === 0) return <Text color="secondary">{empty}</Text>;

  return (
    <Grid columns={{ minWidth: CARD_MIN_WIDTH, max: CARD_COLUMNS }} gap={4}>
      {groups.map((group) => {
        const ids = group.rows.map((row) => row.id);
        const chosen = ids.filter((id) => selected.includes(id)).length;
        const active = group.rows.find((row) => row.id === shown[group.key]) ?? firstShown(group);
        const isDefault = group.rows.some((row) => row.isPrimary);
        const count = active.skillCount ?? active.skillProfile?.length ?? 0;
        return (
          <Card key={group.key} padding={5}>
            <Stack gap={4}>
              <HStack hAlign="between" vAlign="center" gap={2}>
                <HStack gap={2} vAlign="center">
                  {selectable ? (
                    <CheckboxInput
                      label={`Select ${group.label}`}
                      isLabelHidden
                      value={chosen === 0 ? false : chosen === ids.length ? true : "indeterminate"}
                      isDisabled={busy}
                      onChange={(checked) =>
                        onSelect(
                          checked
                            ? [...new Set([...selected, ...ids])]
                            : selected.filter((id) => !ids.includes(id)),
                        )
                      }
                    />
                  ) : null}
                  <Heading level={3}>{group.label}</Heading>
                </HStack>
                {isDefault ? <Badge label="Default" variant="blue" /> : null}
              </HStack>
              {group.rows.length > 1 ? (
                <SegmentedControl
                  label={`${group.label} format`}
                  size="sm"
                  value={active.id}
                  onChange={(value) => setShown({ ...shown, [group.key]: String(value) })}
                >
                  {group.rows.map((row) => (
                    <SegmentedControlItem
                      key={row.id}
                      value={row.id}
                      label={row.format.toUpperCase()}
                    />
                  ))}
                </SegmentedControl>
              ) : null}
              <Text type="supporting" color="secondary">
                {[
                  active.format.toUpperCase(),
                  active.size ? formatBytes(active.size) : "",
                  formatWhen(active.uploadedAt) ? `Updated ${formatWhen(active.uploadedAt)}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <HStack gap={2} vAlign="center" wrap="wrap">
                {active.analyzed ? <Badge label="Analyzed" variant="green" /> : null}
                {active.analyzed && count > 0 ? (
                  <Button
                    label={`${count} skills`}
                    variant="ghost"
                    size="sm"
                    onClick={() => onShowSkills(active)}
                  />
                ) : null}
              </HStack>
              <HStack gap={1} hAlign="between" vAlign="center">
                {isDefault ? (
                  <span />
                ) : (
                  <Button
                    label="Make default"
                    variant="secondary"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => onMakeDefault(active)}
                  />
                )}
                <IconButton
                  label={`Remove ${active.fileName}`}
                  icon={<Glyph name="trash" />}
                  variant="ghost"
                  size="sm"
                  isDisabled={busy}
                  onClick={() => onRemove(active)}
                />
              </HStack>
            </Stack>
          </Card>
        );
      })}
    </Grid>
  );
}
