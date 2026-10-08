import type { ComponentProps } from "react";
import { HStack, TopNavHeading } from "sid-ui";
import { BRAND } from "@/lib/config";
import { AcornWordmark } from "./acorn-wordmark";

type AcornHeadingProps = Omit<
  ComponentProps<typeof TopNavHeading>,
  "logo" | "logoLabel" | "heading"
>;

/**
 * The Acorn wordmark, for every top bar on the site. A logo-only TopNavHeading
 * drops `headerEndContent`, so that content (the Beta badge) sits beside it here.
 */
export function AcornHeading({ headerEndContent, ...props }: AcornHeadingProps) {
  const heading = <TopNavHeading {...props} logo={<AcornWordmark />} logoLabel={BRAND} />;
  if (!headerEndContent) return heading;
  return (
    <HStack gap={2} vAlign="center">
      {heading}
      {headerEndContent}
    </HStack>
  );
}
