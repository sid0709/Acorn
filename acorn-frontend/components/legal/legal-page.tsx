import { Heading, Link, PageContainer, Stack, Text } from "sid-ui";
import { SiteHeader } from "@/components/site-header";
import { contactEmail } from "@/lib/config";
import { LEGAL_UPDATED, type LegalDocument } from "@/lib/legal";
import { ROUTES } from "@/lib/routes";

/** A public legal document: header, dated title, sections, and the contact line. */
export function LegalPage({ document }: { document: LegalDocument }) {
  const email = contactEmail();
  return (
    <PageContainer width="narrow">
      <Stack gap={8}>
        <SiteHeader hasSignIn />
        <Stack gap={1}>
          <Heading level={1}>{document.title}</Heading>
          <Text color="secondary">Last updated {LEGAL_UPDATED}</Text>
        </Stack>
        {document.sections.map((section) => (
          <Stack key={section.heading} gap={3} as="section">
            <Heading level={2}>{section.heading}</Heading>
            {section.paragraphs?.map((paragraph) => (
              <Text key={paragraph} display="block">
                {paragraph}
              </Text>
            ))}
            {section.items ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>
                    <Text display="block">{item}</Text>
                  </li>
                ))}
              </ul>
            ) : null}
            {section.link ? (
              <Text display="block">
                <Link href={section.link.href} target="_blank" rel="noopener noreferrer">
                  {section.link.label}
                </Link>
              </Text>
            ) : null}
          </Stack>
        ))}
        <Stack gap={3} as="section">
          <Heading level={2}>Contact</Heading>
          <Text display="block">
            {email ? (
              <>
                Questions about this document? Email <Link href={`mailto:${email}`}>{email}</Link>.
              </>
            ) : (
              "Questions about this document? Contact us through the Acorn website."
            )}
          </Text>
          <Text type="supporting" color="secondary">
            <Link href={ROUTES.privacy}>Privacy Policy</Link> ·{" "}
            <Link href={ROUTES.terms}>Terms of Service</Link>
          </Text>
        </Stack>
      </Stack>
    </PageContainer>
  );
}
