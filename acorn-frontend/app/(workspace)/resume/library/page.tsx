import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResumeLibrary } from "@/components/workspace/resume/resume-library";
import { currentAccount } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Resume library" };

export default async function ResumeLibraryPage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  return <ResumeLibrary />;
}
