import type { ComponentProps } from "react";
import { TopNavHeading } from "sid-ui";
import { BRAND } from "@/lib/config";
import { AcornMark } from "./acorn-mark";

/** The Acorn mark and name, for every top bar on the site. */
export function AcornHeading(
  props: Omit<ComponentProps<typeof TopNavHeading>, "logo" | "logoLabel" | "heading">,
) {
  return <TopNavHeading {...props} logo={<AcornMark size="sm" />} heading={BRAND} />;
}
