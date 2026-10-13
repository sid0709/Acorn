import { BRAND } from "./config";

/**
 * Copy for the Privacy Policy and Terms of Service pages. Draft text: have it
 * reviewed before it goes through Google's OAuth verification.
 */

export const LEGAL_UPDATED = "October 13, 2026";

/** Google's policy the Limited Use disclosure points to. */
export const GOOGLE_USER_DATA_POLICY_URL =
  "https://developers.google.com/terms/api-services-user-data-policy";

/** Where a user reviews or removes the access Acorn was granted. */
export const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
  link?: { label: string; href: string };
};

export type LegalDocument = {
  title: string;
  description: string;
  sections: LegalSection[];
};

export const PRIVACY: LegalDocument = {
  title: "Privacy Policy",
  description: `How ${BRAND} collects, uses, stores, and shares your information, including data from your Google account.`,
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        `${BRAND} is an AI auto-bid agent for job seekers. It is a website and a browser extension that tailor resumes, fill in job applications, and track recruiter replies. This policy explains what information ${BRAND} handles and why.`,
      ],
    },
    {
      heading: "Information we collect",
      items: [
        "Account details: your name, email address, and a hashed password if you sign up with email.",
        "Profile and resume content you provide: work history, education, skills, answers to screening questions, and the resumes you upload or generate.",
        "Application activity: the jobs you apply to through the extension and their status.",
        "Google account data, only if you choose to connect it. See the next section.",
        "Billing details: your plan and payment status. Card numbers are handled by our payment processor, not stored by us.",
        "Basic technical data such as browser type and error logs, used to keep the service working.",
      ],
    },
    {
      heading: "Google user data",
      paragraphs: [
        "You can sign in with Google and, separately, connect a Gmail mailbox and Google Calendar. We request only the access each feature needs:",
      ],
      items: [
        "Sign-in (openid, email, profile): to identify you and create your account.",
        "Gmail read access (gmail.readonly): to find replies to your job applications and show them next to the application.",
        "Gmail label access (gmail.modify): to apply labels to application-related messages. We never send email, and we never permanently delete messages.",
        "Google Calendar events (calendar.events): to add interviews and follow-ups you schedule to your calendar.",
      ],
    },
    {
      heading: "How we use Google user data",
      paragraphs: [
        `We use Google user data only to provide and improve the user-facing features described above: sign-in, reply tracking, labeling, and calendar events. We do not use it for advertising, we do not sell it, and we do not use it to train generalized AI or machine-learning models. We do not allow humans to read your email unless you give explicit permission for specific messages, it is needed for security or to comply with law, or the data is aggregated and anonymized for internal operations.`,
        `${BRAND}'s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.`,
      ],
      link: { label: "Google API Services User Data Policy", href: GOOGLE_USER_DATA_POLICY_URL },
    },
    {
      heading: "How we use other information",
      items: [
        "To run the service: build resumes, autofill forms, and answer screening questions on your behalf.",
        "To process payments and manage your plan.",
        "To secure accounts, prevent abuse, and fix problems.",
        "To contact you about your account and important changes to the service.",
      ],
    },
    {
      heading: "Sharing",
      paragraphs: ["We do not sell your personal information. We share it only with:"],
      items: [
        "Service providers that help us run Acorn, such as hosting, payment processing, and AI model providers that process resume and job-posting text to generate content. They may use the data only to provide their service to us.",
        "Employers and job sites, but only the application details you choose to submit through the extension.",
        "Authorities, when the law requires it.",
      ],
    },
    {
      heading: "Storage and security",
      paragraphs: [
        "Data is stored on servers we control or rent from reputable hosting providers and is encrypted in transit. Google access tokens are stored encrypted and used only to carry out the features you enabled. No system is perfectly secure, but we work to protect your data from unauthorized access.",
      ],
    },
    {
      heading: "Retention, deletion, and your choices",
      items: [
        "Disconnect Gmail or Calendar at any time from the Gmail page in Acorn. Disconnecting removes the stored Google tokens.",
        "You can also revoke Acorn's access from your Google account permissions page.",
        "Delete your account from Acorn at any time. This removes your profile, resumes, application history, and any stored Google data.",
        "Backups and logs are purged on a rolling basis, and we may keep limited records where the law requires.",
        "You may ask us to access, correct, or delete your information by contacting us below.",
      ],
      link: { label: "Google account permissions", href: GOOGLE_PERMISSIONS_URL },
    },
    {
      heading: "Children",
      paragraphs: [
        `${BRAND} is not intended for anyone under 16, and we do not knowingly collect their information.`,
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "We may update this policy. When we make a material change we will update the date above and, where appropriate, notify you in the app or by email.",
      ],
    },
  ],
};

export const TERMS: LegalDocument = {
  title: "Terms of Service",
  description: `The terms that apply when you use ${BRAND}.`,
  sections: [
    {
      heading: "Agreement",
      paragraphs: [
        `By creating an account or using ${BRAND}, you agree to these terms and to our Privacy Policy. If you do not agree, do not use the service.`,
      ],
    },
    {
      heading: "The service",
      paragraphs: [
        `${BRAND} provides a website and browser extension that help you tailor resumes, fill in job applications, and track replies. You must be at least 16 and able to form a binding contract.`,
      ],
    },
    {
      heading: "Your account",
      items: [
        "Give accurate information and keep your sign-in details secure.",
        "You are responsible for activity on your account.",
        "Tell us promptly if you think your account was accessed without permission.",
      ],
    },
    {
      heading: "Your content and your applications",
      paragraphs: [
        `You own your resumes, profile, and other content. You give ${BRAND} permission to process it to provide the service, including sending it to the employers and sites you choose to apply to. You are responsible for the accuracy of what is submitted in your name. Review generated resumes and answers before relying on them. ${BRAND} does not guarantee interviews, offers, or any hiring outcome.`,
      ],
    },
    {
      heading: "Acceptable use",
      items: [
        "Do not use the service to submit false or misleading information, or to apply on behalf of someone who has not authorized you.",
        "Do not break the terms of the job sites you apply to, or use the service to spam, scrape, or harm others.",
        "Do not probe, disrupt, or reverse engineer the service, or attempt to access other users' data.",
        "Do not violate any law.",
      ],
    },
    {
      heading: "Connected Google services",
      paragraphs: [
        "If you connect Gmail or Google Calendar, you authorize Acorn to use that access as described in the Privacy Policy. You can disconnect at any time, and your use of Google services remains subject to Google's own terms.",
      ],
    },
    {
      heading: "Plans and payment",
      paragraphs: [
        "Paid plans are billed in advance for the interval you choose and renew until canceled. You can cancel at any time and keep access until the end of the paid period. Fees are non-refundable except where the law requires otherwise.",
      ],
    },
    {
      heading: "Ending your use",
      paragraphs: [
        `You may stop using ${BRAND} and delete your account at any time. We may suspend or end access if you break these terms or put the service or other users at risk.`,
      ],
    },
    {
      heading: "Disclaimers and liability",
      paragraphs: [
        `The service is provided "as is" and "as available", without warranties of any kind. To the fullest extent the law allows, ${BRAND} is not liable for indirect or consequential damages, or for lost opportunities, and its total liability is limited to the amount you paid in the 12 months before the claim.`,
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "We may update these terms. If a change is material we will tell you, and continued use after the change means you accept it.",
      ],
    },
  ],
};
