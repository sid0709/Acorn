import type { Metadata } from "next";

import { ClaimsWorkspace } from "@/components/claims/claims-workspace";

export const metadata: Metadata = { title: "Claim" };

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { id } = await params;
  return <ClaimsWorkspace selectedId={id} searchParams={await searchParams} />;
}
