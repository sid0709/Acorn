import type { Metadata } from "next";
import { PLANS } from "./billing";
import { BRAND, siteUrl } from "./config";
import { ALL_KEYWORDS } from "./keywords";
import { FAQS, FEATURES, POSITIONING, SLOGAN } from "./landing";
import { ROUTES } from "./routes";

/** What search engines and link previews show for the site. */

export const SITE_TITLE = `${BRAND}: No. 1 AI Auto-Bid Agent for Job Seekers | Auto Apply to Jobs`;

export const SITE_DESCRIPTION =
  "Acorn is the No. 1 auto-bid agent for job seekers. Its AI applies to jobs for you: ATS-friendly resumes, autofilled forms, screening answers, and reply tracking.";

const PRICE_CURRENCY = "USD";
const SITE_LOCALE = "en_US";
const OPERATING_SYSTEMS = "Chrome, Edge, Brave, Arc";

/** Signed-in, callback, and API paths: never crawled. */
export const PRIVATE_PATHS = [
  ROUTES.overview,
  ROUTES.profile,
  ROUTES.resume,
  ROUTES.gmail,
  ROUTES.apps,
  ROUTES.billing,
  ROUTES.supportSession,
  "/auth/",
  "/api/",
];

/** Signed-in pages and one-off flows stay out of the index. */
export const NO_INDEX: Metadata["robots"] = { index: false, follow: false };

export function absoluteUrl(path: string) {
  return new URL(path, siteUrl()).toString();
}

/** The defaults every page inherits; pages override the title and canonical path. */
export function rootMetadata(): Metadata {
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: SITE_TITLE, template: `%s · ${BRAND}` },
    description: SITE_DESCRIPTION,
    applicationName: BRAND,
    keywords: ALL_KEYWORDS,
    category: "productivity",
    creator: BRAND,
    publisher: BRAND,
    formatDetection: { email: false, address: false, telephone: false },
    alternates: { canonical: ROUTES.home },
    openGraph: {
      type: "website",
      siteName: BRAND,
      locale: SITE_LOCALE,
      url: ROUTES.home,
      title: SITE_TITLE,
      description: `${POSITIONING}. ${SLOGAN}`,
    },
    twitter: {
      card: "summary",
      title: SITE_TITLE,
      description: `${POSITIONING}. ${SLOGAN}`,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

/** Organization, WebSite, the extension as a SoftwareApplication, and the FAQ. */
export function homeStructuredData() {
  const home = absoluteUrl(ROUTES.home);
  const organizationId = `${home}#organization`;
  const prices = PLANS.map((plan) => plan.price.monthly);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: BRAND,
        url: home,
        logo: absoluteUrl("/icon.svg"),
        slogan: SLOGAN,
      },
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        name: BRAND,
        url: home,
        description: SITE_DESCRIPTION,
        publisher: { "@id": organizationId },
        inLanguage: "en",
        keywords: ALL_KEYWORDS.join(", "),
      },
      {
        "@type": "SoftwareApplication",
        name: BRAND,
        url: home,
        description: SITE_DESCRIPTION,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Job search automation",
        keywords: ALL_KEYWORDS.join(", "),
        featureList: FEATURES.map((feature) => feature.title),
        operatingSystem: OPERATING_SYSTEMS,
        publisher: { "@id": organizationId },
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: PRICE_CURRENCY,
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: PLANS.length,
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so a string cannot close the tag. */
export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
