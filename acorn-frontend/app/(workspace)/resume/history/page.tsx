import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RESUME_HISTORY_PER_PAGE } from "@acorn/shared/resume-history";
import { ResumeHistory } from "@/components/workspace/resume/resume-history";
import { SectionSkeleton } from "@/components/workspace/section-skeleton";
import { currentAccount, type AcornAccount } from "@/lib/auth/session";
import { listGenerations } from "@/lib/resume/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Resume history" };

/** The Resume header and tabs show at once; the history streams in. */
export default async function ResumeHistoryPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <HistorySection account={account} />
    </Suspense>
  );
}

async function HistorySection({ account }: { account: AcornAccount }) {
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
