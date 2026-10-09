import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ResumeLibrary } from "@/components/workspace/resume/resume-library";
import { SectionSkeleton } from "@/components/workspace/section-skeleton";
import { currentAccount } from "@/lib/auth/session";
import { listLibrary } from "@/lib/resume/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Resume library" };

/** The Resume header and tabs show at once; the Library streams in. */
export default async function ResumeLibraryPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <LibrarySection />
    </Suspense>
  );
}

async function LibrarySection() {
  const library = await listLibrary();
  return <ResumeLibrary initial={library} />;
}
