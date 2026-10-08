import { HStack, Link, Stack, Text } from "sid-ui";
import { AcornMark } from "@/components/brand/acorn-mark";
import { BRAND } from "@/lib/config";
import { LANDING_SECTIONS, POSITIONING, SLOGAN } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";
import { LandingContainer } from "./landing-section";

const anchor = (id: string) => `#${id}`;

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Auto-bid agent", href: anchor(LANDING_SECTIONS.agent) },
      { label: "Features", href: anchor(LANDING_SECTIONS.features) },
      { label: "ATS resume builder", href: anchor(LANDING_SECTIONS.resume) },
      { label: "Pricing", href: anchor(LANDING_SECTIONS.pricing) },
    ],
  },
  {
    title: "Job seekers",
    links: [
      { label: "Who it's for", href: anchor(LANDING_SECTIONS.useCases) },
      { label: "Manual vs. auto-bid", href: anchor(LANDING_SECTIONS.compare) },
      { label: "Job search topics", href: anchor(LANDING_SECTIONS.topics) },
      { label: "FAQ", href: anchor(LANDING_SECTIONS.faq) },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Create free account", href: ROUTES.signUp },
      { label: "Sign in", href: ROUTES.signIn },
    ],
  },
];

export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="lp-footer">
      <LandingContainer>
        <Stack gap={10}>
          <div className="lp-footer-grid">
            <Stack gap={3}>
              <HStack gap={2} vAlign="center">
                <AcornMark size="md" />
                <Text type="large" weight="bold">
                  {BRAND}
                </Text>
              </HStack>
              <Text weight="semibold">{POSITIONING}.</Text>
              <Text color="secondary" display="block">
                {SLOGAN}
              </Text>
            </Stack>
            {COLUMNS.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <Stack gap={3}>
                  <Text weight="semibold">{column.title}</Text>
                  <ul className="lp-footer-list">
                    {column.links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} color="secondary">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Stack>
              </nav>
            ))}
          </div>
          <HStack hAlign="between" gap={3} wrap="wrap">
            <Text type="supporting" color="secondary">
              © {year} {BRAND}. All rights reserved.
            </Text>
            <Text type="supporting" color="secondary">
              AI auto-bid, autofill, and ATS resumes for job seekers.
            </Text>
          </HStack>
        </Stack>
      </LandingContainer>
    </footer>
  );
}
