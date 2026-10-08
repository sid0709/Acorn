import type { ReactNode } from "react";
import { Badge, Glyph, Heading, PAGE_WIDTHS, Stack, Text, type GlyphName } from "sid-ui";

/** The page's content column; full-bleed backgrounds sit outside it. */
export function LandingContainer({ children }: { children: ReactNode }) {
  return <div className="lp-container">{children}</div>;
}

/** The eyebrow, heading, and lede that open a section. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "center",
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  align?: "center" | "start";
}) {
  const centered = align === "center";
  const justify = centered ? "center" : "start";
  return (
    <Stack gap={4} hAlign={justify} maxWidth={centered ? PAGE_WIDTHS.narrow : undefined}>
      <Badge label={eyebrow} variant="orange" />
      <Heading level={2} id={id} justify={justify} className="lp-title">
        {title}
      </Heading>
      {description ? (
        <Text color="secondary" display="block" justify={justify} className="lp-lede">
          {description}
        </Text>
      ) : null}
    </Stack>
  );
}

/** A landing <section>, labelled by its heading, centered in the content column. */
export function LandingSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="lp-section">
      <LandingContainer>
        <Stack gap={10}>
          <Stack hAlign="center">
            <SectionHeading
              id={headingId}
              eyebrow={eyebrow}
              title={title}
              description={description}
            />
          </Stack>
          {children}
        </Stack>
      </LandingContainer>
    </section>
  );
}

/** A glyph on a soft gradient tile, for feature and step cards. */
export function IconTile({ icon, tone = "orange" }: { icon: GlyphName; tone?: "orange" | "blue" }) {
  return (
    <span className={tone === "blue" ? "lp-icon-tile lp-icon-tile-blue" : "lp-icon-tile"}>
      <Glyph name={icon} />
    </span>
  );
}
