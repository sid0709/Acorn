import { Avatar, Badge, Card, Glyph, HStack, Heading, ProgressBar, Stack, Text } from "sid-ui";
import { completeness, profileChecklist, type ApplicantProfile } from "@/lib/workspace/profile";

const AVATAR_SIZE = 72;
const READY = 80;
const HALF = 50;

/** Identity at a glance. Every other fact lives once, in its tab. */
export function ProfileSummary({ profile }: { profile: ApplicantProfile }) {
  const current = profile.timeline.find((entry) => entry.kind === "role" && entry.current);
  const role = current ? `${current.title} · ${current.org}` : profile.headline;
  const place = [profile.city, profile.state || profile.country].filter(Boolean).join(", ");
  const checklist = profileChecklist(profile);
  const percent = completeness(checklist);
  const done = checklist.filter((item) => item.done).length;
  const name = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ");

  return (
    <Card padding={6}>
      <Stack gap={5}>
        <Stack gap={3} hAlign="center">
          <Avatar name={name || profile.fullName} size={AVATAR_SIZE} />
          <Stack gap={1} hAlign="center">
            <Heading level={2}>{name || profile.fullName || "Your name"}</Heading>
            <Text color="secondary">{role || "Add your current role"}</Text>
          </Stack>
          {place ? <Badge label={place} variant="neutral" icon={<Glyph name="pin" />} /> : null}
        </Stack>
        <Stack gap={2}>
          <HStack hAlign="between" vAlign="end">
            <Text type="label" color="secondary">
              Profile completion
            </Text>
            <Heading level={2} type="display-3">
              {`${percent}%`}
            </Heading>
          </HStack>
          <ProgressBar
            label="Profile completion"
            isLabelHidden
            value={percent}
            variant={percent >= READY ? "success" : percent >= HALF ? "accent" : "warning"}
          />
          <Text type="supporting" color="secondary">
            {`${done} of ${checklist.length} sections answered`}
          </Text>
        </Stack>
      </Stack>
    </Card>
  );
}
