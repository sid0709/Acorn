import Link from "next/link";
import { notFound } from "next/navigation";
import { Text, VStack } from "sid-ui";

import { ClaimStatusForm } from "@/components/claim-status-form";
import { getClaim } from "@/lib/api/admin-data";

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await getClaim(id);
  if (!claim) notFound();
  const src = claim.screenshotBase64
    ? `data:${claim.screenshotMime};base64,${claim.screenshotBase64}`
    : null;
  return (
    <VStack gap={4}>
      <Link href="/claims">← Claims</Link>
      <Text as="h1" type="large" weight="semibold">
        {claim.pageTitle || "Report"}
      </Text>
      <ClaimStatusForm id={claim.id} status={claim.status} />
      <Text type="supporting">
        {claim.userName} · {claim.userEmail} · v{claim.extensionVersion || "?"}
      </Text>
      <a href={claim.pageUrl} target="_blank" rel="noreferrer">
        {claim.pageUrl}
      </a>
      <Text type="supporting">Reported {new Date(claim.createdAt).toLocaleString()}</Text>
      {src ? (
        <img className="acorn-admin-screenshot" src={src} alt="Tab screenshot at report time" />
      ) : (
        <Text type="supporting">No screenshot stored.</Text>
      )}
    </VStack>
  );
}
