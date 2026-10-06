"use client";

import { useState } from "react";
import {
  Button,
  EmptyState,
  Glyph,
  SectionCard,
  Stack,
  StatGrid,
  type GlyphName,
  type Stat,
} from "sid-ui";
import {
  blankEntry,
  entriesOf,
  experienceMonths,
  formatDuration,
  type ApplicantProfile,
  type CareerEntry,
  type EntryKind,
} from "@/lib/workspace/profile";
import { CareerChart } from "./career-chart";
import { TimelineEntry } from "./timeline-entry";

const SECTION = {
  role: {
    title: "Experience",
    description: "Every role, most recent first. Acorn answers work-history questions from this.",
    add: "Add role",
    icon: "seat",
    empty: "No roles yet",
    emptyHint: "Upload your résumé above to fill them in, or add one by hand.",
  },
  education: {
    title: "Education",
    description: "Degrees, diplomas, and programs. Applications ask for school, degree, and dates.",
    add: "Add school",
    icon: "bookmark",
    empty: "No education yet",
    emptyHint: "Upload your résumé above to fill it in, or add a school by hand.",
  },
} as const satisfies Record<EntryKind, { icon: GlyphName } & Record<string, string>>;

/** Experience or education: the entries of one kind, editable in place. */
export function TimelineSection({
  kind,
  profile,
  today,
  onChange,
}: {
  kind: EntryKind;
  profile: ApplicantProfile;
  today: Date;
  onChange: (profile: ApplicantProfile) => void;
}) {
  const [added, setAdded] = useState<string | null>(null);
  const copy = SECTION[kind];
  const entries = entriesOf(profile, kind);

  const add = () => {
    const entry = blankEntry(kind);
    setAdded(entry.id);
    onChange({ ...profile, timeline: [entry, ...profile.timeline] });
  };
  const update = (id: string, patch: Partial<CareerEntry>) =>
    onChange({
      ...profile,
      timeline: profile.timeline.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });
  const remove = (id: string) =>
    onChange({ ...profile, timeline: profile.timeline.filter((entry) => entry.id !== id) });

  const addButton = (
    <Button label={copy.add} variant="secondary" icon={<Glyph name="plus" />} onClick={add} />
  );

  return (
    <Stack gap={4}>
      {kind === "role" && entries.length > 0 ? (
        <StatGrid stats={roleStats(profile, entries, today)} />
      ) : null}
      <SectionCard title={copy.title} description={copy.description} action={addButton}>
        {entries.length === 0 ? (
          <EmptyState
            title={copy.empty}
            description={copy.emptyHint}
            icon={<Glyph name={copy.icon} />}
            actions={addButton}
            isCompact
          />
        ) : (
          <Stack gap={3}>
            {entries.map((entry) => (
              <TimelineEntry
                key={entry.id}
                entry={entry}
                today={today}
                isNew={entry.id === added}
                onChange={(patch) => update(entry.id, patch)}
                onRemove={() => remove(entry.id)}
              />
            ))}
          </Stack>
        )}
      </SectionCard>
      {kind === "role" && entries.length > 1 ? (
        <SectionCard title="Time in each role" description="Your current role is highlighted.">
          <CareerChart profile={profile} today={today} />
        </SectionCard>
      ) : null}
    </Stack>
  );
}

function roleStats(profile: ApplicantProfile, roles: CareerEntry[], today: Date): Stat[] {
  const current = roles.find((entry) => entry.current);
  const companies = new Set(roles.map((entry) => entry.org.trim().toLowerCase()).filter(Boolean));
  return [
    { label: "Total experience", value: formatDuration(experienceMonths(profile, today)) },
    {
      label: "Roles",
      value: String(roles.length),
      hint: companies.size === 1 ? "1 company" : `${companies.size} companies`,
    },
    {
      label: "Current role",
      value: current?.org || "—",
      hint: current ? current.title : "No current role",
    },
  ];
}
