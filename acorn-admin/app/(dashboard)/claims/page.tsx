import type { Metadata } from "next";

import { ClaimsWorkspace } from "@/components/claims/claims-workspace";

export const metadata: Metadata = { title: "Claims" };

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  return <ClaimsWorkspace selectedId={null} searchParams={await searchParams} />;
}
