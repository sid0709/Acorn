import { entriesOf, type ApplicantProfile } from "./profile";

/** Profile answers a résumé can fill, grouped the way the profile shows them. */
const FILLED_GROUPS: { label: string; keys: (keyof ApplicantProfile)[] }[] = [
  { label: "Name", keys: ["fullName", "firstName", "middleName", "lastName"] },
  { label: "Headline", keys: ["headline"] },
  { label: "Email", keys: ["email"] },
  { label: "Phone", keys: ["phone"] },
  { label: "Location", keys: ["street", "city", "state", "country", "zip"] },
  { label: "LinkedIn", keys: ["linkedin"] },
  { label: "GitHub", keys: ["github"] },
  { label: "Portfolio", keys: ["portfolio"] },
];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a résumé fill changed or confirmed, as short labels: "Name", "Location",
 * "3 roles", "1 school". A group counts when the résumé left it filled.
 */
export function filledLabels(after: ApplicantProfile) {
  const labels = FILLED_GROUPS.filter((group) =>
    group.keys.some((key) => String(after[key] ?? "").trim()),
  ).map((group) => group.label);
  const roles = entriesOf(after, "role").length;
  const schools = entriesOf(after, "education").length;
  if (roles) labels.push(count(roles, "role", "roles"));
  if (schools) labels.push(count(schools, "school", "schools"));
  return labels;
}
