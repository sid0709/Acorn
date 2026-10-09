import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RESUME_HISTORY_PER_PAGE } from "@acorn/shared/resume-history";
import { ResumeHistory } from "@/components/workspace/resume/resume-history";
import { currentAccount } from "@/lib/auth/session";
import { listGenerations } from "@/lib/resume/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Resume history" };

export default async function ResumeHistoryPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  const history = await listGenerations({
    search: "",
    searchIn: "all",
    status: "all",
    sort: "newest",
    limit: RESUME_HISTORY_PER_PAGE,
    offset: 0,
    includeFacets: true,
  });
  return <ResumeHistory account={account} initial={history} />;
}
