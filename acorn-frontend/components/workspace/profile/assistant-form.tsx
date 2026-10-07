import { FormLayout, SectionCard, Stack, TextInput } from "sid-ui";
import {
  AI_MODEL_LABEL,
  PATH_MAX,
  SALARY_MAX,
  SECRET_MAX,
  type ApplicantProfile,
  type SetProfileField,
} from "@/lib/workspace/profile";

/** Salary, the OpenRouter key, and the résumé folder. */
export function AssistantForm({
  profile,
  onChange,
}: {
  profile: ApplicantProfile;
  onChange: SetProfileField;
}) {
  return (
    <Stack gap={4}>
      <JobBid profile={profile} onChange={onChange} />
    </Stack>
  );
}

function JobBid({ profile, onChange }: { profile: ApplicantProfile; onChange: SetProfileField }) {
  return (
    <SectionCard title="Job bid assistant" description="Salary, API key, and resume path.">
      <FormLayout>
        <TextInput
          label="Desired salary (annual)"
          value={profile.desiredSalary}
          onChange={(value) =>
            onChange("desiredSalary", value.replace(/\D/g, "").slice(0, SALARY_MAX))
          }
        />
        <TextInput
          label="OpenRouter API key"
          type="password"
          value={profile.openrouterApiKey}
          onChange={(value) => onChange("openrouterApiKey", value.slice(0, SECRET_MAX))}
          description="Used for every AI request."
        />
        <TextInput label="Model" value={AI_MODEL_LABEL} isReadOnly />
        <TextInput
          label="Default account password"
          type="password"
          value={profile.defaultAccountPassword}
          onChange={(value) => onChange("defaultAccountPassword", value.slice(0, SECRET_MAX))}
          description="Used when an application requires sign-up / sign-in."
        />
        <TextInput
          label="Resume folder path"
          value={profile.resumeFolderPath}
          onChange={(value) => onChange("resumeFolderPath", value.slice(0, PATH_MAX))}
        />
      </FormLayout>
    </SectionCard>
  );
}
