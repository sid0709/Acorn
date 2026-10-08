import { Button, HStack, Hide, TopNav } from "sid-ui";
import { AcornHeading } from "@/components/brand/acorn-heading";
import { BRAND } from "@/lib/config";
import { LANDING_NAV } from "@/lib/landing";
import { ROUTES } from "@/lib/routes";

/** The signed-out top bar on the home page: brand, section links, sign-in and sign-up. */
export function LandingNav() {
  return (
    <TopNav
      label={BRAND}
      heading={<AcornHeading headingHref={ROUTES.home} />}
      centerContent={
        <Hide below="md" responsiveTo="viewport">
          <HStack as="nav" aria-label="Sections" gap={1}>
            {LANDING_NAV.map((item) => (
              <Button
                key={item.id}
                label={item.label}
                variant="ghost"
                size="sm"
                href={`#${item.id}`}
              />
            ))}
          </HStack>
        </Hide>
      }
      endContent={
        <HStack gap={2}>
          <Button label="Sign in" variant="ghost" size="sm" href={ROUTES.signIn} />
          <Button label="Get started" variant="primary" size="sm" href={ROUTES.signUp} />
        </HStack>
      }
    />
  );
}
