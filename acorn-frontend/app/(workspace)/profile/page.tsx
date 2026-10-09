import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ProfilePanel } from "@/components/workspace/profile-panel";
import { SectionSkeleton } from "@/components/workspace/section-skeleton";
import { currentAccount, type AcornAccount } from "@/lib/auth/session";
import { loadProfile } from "@/lib/profile/api";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Profile" };

/** The page frame shows at once; the profile streams in when the API answers. */
export default async function ProfilePage() {
  const account = await currentAccount();
  if (!account) redirect(ROUTES.signIn);
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <ProfileSection account={account} />
    </Suspense>
  );
}

async function ProfileSection({ account }: { account: AcornAccount }) {
  const profile = await loadProfile();
  return <ProfilePanel account={account} initial={profile} />;
}
