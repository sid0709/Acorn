import type { Metadata } from "next";

import { ClaimsWorkspace } from "@/components/claims/claims-workspace";

export const metadata: Metadata = { title: "Claims" };

export default function ClaimsPage() {
  return <ClaimsWorkspace />;
}
