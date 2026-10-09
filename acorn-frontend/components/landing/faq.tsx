import { Card, Collapsible, CollapsibleGroup, PAGE_WIDTHS, Stack, Text } from "sid-ui";
import { FAQS, LANDING_SECTIONS } from "@/lib/landing";
import { LandingSection } from "./landing-section";

/** Answers stay in the DOM while collapsed, so crawlers read them with the FAQPage data. */
export function Faq() {
  return (
    <LandingSection
      id={LANDING_SECTIONS.faq}
      eyebrow="FAQ"
      title="Auto-bid questions, answered"
      description="Everything job seekers ask about Acorn, AI auto-apply, and ATS-friendly resumes."
    >
      <Stack hAlign="center">
        <Card padding={4} width="100%" maxWidth={PAGE_WIDTHS.narrow}>
          <CollapsibleGroup type="multiple" hasDividers defaultValue={[FAQS[0].question]}>
            {FAQS.map((faq) => (
              <Collapsible
                key={faq.question}
                value={faq.question}
                trigger={<Text weight="semibold">{faq.question}</Text>}
              >
                <Text color="secondary" display="block">
                  {faq.answer}
                </Text>
              </Collapsible>
            ))}
          </CollapsibleGroup>
        </Card>
      </Stack>
    </LandingSection>
  );
}
