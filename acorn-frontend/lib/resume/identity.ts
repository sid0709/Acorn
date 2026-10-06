import type { AcornAccount } from "@/lib/auth/session";
import type { ResumeIdentity } from "@acorn/shared/resume-content";
import type { ApplicantProfile } from "@/lib/workspace/profile";

function period(entry: ApplicantProfile["timeline"][number]): string {
  const start = [entry.startMonth, entry.startYear].filter(Boolean).join("/");
  const end = entry.current ? "Present" : [entry.endMonth, entry.endYear].filter(Boolean).join("/");
  return [start, end].filter(Boolean).join(" – ");
}

/** The signed-in account, plus careers stored on this browser's profile. */
export function identityFrom(
  account: AcornAccount,
  profile: ApplicantProfile | null,
): ResumeIdentity {
  const timeline = profile?.timeline ?? [];
  return {
    fullName: profile?.fullName || account.name,
    location: [profile?.city, profile?.state].filter(Boolean).join(", "),
    email: profile?.email || account.email,
    phone: profile?.phone ?? "",
    linkedin: profile?.linkedin ?? "",
    careers: timeline
      .filter((entry) => entry.kind === "role")
      .map((entry) => ({
        company: entry.org,
        title: entry.title,
        period: period(entry),
        description: entry.summary,
      })),
    education: timeline
      .filter((entry) => entry.kind === "education")
      .map((entry) => ({
        school: entry.org,
        degree: entry.title,
        period: period(entry),
      })),
  };
}
