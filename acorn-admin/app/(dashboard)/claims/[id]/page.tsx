import type { Metadata } from "next";

import { ClaimsWorkspace } from "@/components/claims/claims-workspace";

export const metadata: Metadata = { title: "Claim" };

export default function ClaimPage() {
  return <ClaimsWorkspace />;
}
