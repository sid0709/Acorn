import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PRIVACY } from "@/lib/legal";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: PRIVACY.title,
  description: PRIVACY.description,
  alternates: { canonical: ROUTES.privacy },
};

export default function PrivacyPage() {
  return <LegalPage document={PRIVACY} />;
}
