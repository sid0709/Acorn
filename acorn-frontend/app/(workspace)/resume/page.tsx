import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ResumeGenerator } from "@/components/workspace/resume/resume-generator";
import { SectionSkeleton } from "@/components/workspace/section-skeleton";
import { currentAccount, type AcornAccount } from "@/lib/auth/session";
import { listResumeTemplates, loadResumeConfig } from "@/lib/resume/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Generate resume" };

/** The Resume header and tabs show at once; the editor streams in. */
export default async function ResumePage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <GeneratorSection account={account} />
    </Suspense>
  );
}

async function GeneratorSection({ account }: { account: AcornAccount }) {
  const [config, templates] = await Promise.all([loadResumeConfig(), listResumeTemplates()]);
  return <ResumeGenerator account={account} initial={{ config, templates }} />;
}
