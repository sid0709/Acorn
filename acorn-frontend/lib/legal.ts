import { BRAND } from "./config";

/**
 * Copy for the Privacy Policy and Terms of Service pages. They describe what the product does today
 * (see acorn/docs/architecture/extension.md, 19.8 and 19.12). A lawyer should read them before they
 * go through Google's OAuth verification or the Chrome Web Store review.
 */

export const LEGAL_UPDATED = "October 16, 2026";

/** Google's policy the Limited Use disclosure points to. */
export const GOOGLE_USER_DATA_POLICY_URL =
  "https://developers.google.com/terms/api-services-user-data-policy";

/** The Chrome Web Store's policy the extension's Limited Use disclosure points to. */
export const CHROME_USER_DATA_POLICY_URL =
  "https://developer.chrome.com/docs/webstore/program-policies/user-data-faq";

/** Where a user reviews or removes the access Acorn was granted. */
export const GOOGLE_PERMISSIONS_URL = "https://myaccount.google.com/permissions";

export type LegalTable = { head: string[]; rows: string[][] };

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
  table?: LegalTable;
  link?: { label: string; href: string };
};

export type LegalDocument = {
  title: string;
  description: string;
  sections: LegalSection[];
};

/** The in-page anchor of a section, from its heading. */
export function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const PRIVACY: LegalDocument = {
  title: "Privacy Policy",
  description: `How ${BRAND} collects, uses, stores, and shares your information, including page content the browser extension reads and data from your Google account.`,
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        `${BRAND} is an AI auto-bid agent for job seekers. It is a website and a browser extension that tailor resumes, fill in job applications, and track recruiter replies. This policy explains what information ${BRAND} handles, why, and the choices you have.`,
        `The short version: ${BRAND} uses your information only to do the job you ask of it. We do not sell it, we do not use it for advertising, and we do not use it to train AI models.`,
      ],
    },
    {
      heading: "Information we collect",
      items: [
        "Account details: your name, email address, and a hashed password if you sign up with email.",
        "Profile and resume content you provide: work history, education, skills, answers to screening questions, and the resumes and cover letters you upload or generate.",
        "Application activity: the jobs you apply to through the extension and their status.",
        "Settings you save, including the OpenRouter API key you add to your profile and the default password you choose for accounts the agent creates on job sites for you.",
        "Google account data, only if you choose to connect it. See the Google user data section.",
        "Billing details: your plan and payment status. Card numbers are handled by our payment processor, not stored by us.",
        "Basic technical data such as browser type and error logs, used to keep the service working.",
      ],
    },
    {
      heading: "What the extension reads and sends",
      paragraphs: [
        `The ${BRAND} extension works on the page you are on, and only when you start an action from the Acorn side panel (a Run, Fill, Generate, or Recommend). When you do, it can read that page's text, form fields, and structure, and the Agent Run also takes screenshots of the page and acts on it with mouse and keyboard input, the way you would.`,
        "To decide what to fill and click, that page content and the relevant parts of your profile are sent to the Acorn servers, and from there to the AI model provider. The model providers are reached through OpenRouter, using the API key in your profile, so the AI usage is billed to your own OpenRouter account.",
        "Your Acorn sign-in is sent with the request so the server can read your own profile and resumes. The server that plans an Agent Run keeps the run in memory only: it does not save screenshots or your profile to disk, and it forgets the run when it ends.",
        "The extension does not read pages you have not asked it to work on, does not record your browsing, and does not collect your browsing history.",
      ],
    },
    {
      heading: "The run log and support reports",
      paragraphs: [
        "While a run goes on, the extension keeps a detailed log of what it did in your browser (the last five runs of each tab, at most 50 MB). The log stays on your device. Passwords, emailed codes, tokens, and keys are replaced before anything is written to it.",
        "For an Agent Run the log also holds the screenshots the agent was shown, what the AI model was sent and answered, and how long each step took. The Download button in the Logs tab saves all of it as a file on your device. The log leaves your device only if you press Submit on a support report. It is then attached to that report so we can find out what went wrong, and it can contain page text and details from your profile. A report carries the text of the log, not the screenshots. Opening the report form uploads nothing.",
      ],
    },
    {
      heading: "AI model providers",
      paragraphs: [
        `${BRAND} sends resume text, job-posting text, form content, and page screenshots to AI models so they can write answers, choose options, and read pages. The requests run on the OpenRouter key you saved in your profile, and OpenRouter and the model provider it routes to process them under their own terms and privacy policies. We do not send your data to any model provider for purposes other than your request.`,
        "The account password you set as your default for new job-site accounts is filled straight into the page. It is never put in a prompt or a log.",
      ],
    },
    {
      heading: "Google user data",
      paragraphs: [
        "You can sign in with Google and, separately, connect a Gmail mailbox and Google Calendar. We request only the access each feature needs:",
      ],
      items: [
        "Sign-in (openid, email, profile): to identify you and create your account.",
        "Gmail read access (gmail.readonly): to find replies to your job applications and show them next to the application, and, while a run is waiting on a job site, to find the verification code or link that site emailed you.",
        "Gmail label access (gmail.modify): to apply labels to application-related messages. We never send email, and we never permanently delete messages.",
        "Google Calendar events (calendar.events): to add interviews and follow-ups you schedule to your calendar.",
      ],
    },
    {
      heading: "How we use Google user data",
      paragraphs: [
        `We use Google user data only to provide and improve the user-facing features described above: sign-in, reply tracking, finding the verification code a job site emailed you, labeling, and calendar events. To find a verification code, the sender, subject, and text of your newest messages are read by an AI decision model, which picks the one email that holds the code. We do not use Google user data for advertising, we do not sell it, and we do not use it to train generalized AI or machine-learning models. We do not allow humans to read your email unless you give explicit permission for specific messages, it is needed for security or to comply with law, or the data is aggregated and anonymized for internal operations.`,
        `${BRAND}'s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.`,
      ],
      link: { label: "Google API Services User Data Policy", href: GOOGLE_USER_DATA_POLICY_URL },
    },
    {
      heading: "Chrome Web Store limited use",
      paragraphs: [
        `The use of information collected by the ${BRAND} extension will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. Specifically:`,
      ],
      items: [
        "We use the data only to provide or improve the single purpose of the extension: applying to jobs for you.",
        "We do not sell or transfer the data to third parties, except to the service providers named in this policy that are needed to do what you asked, to comply with law, or as part of a merger or sale with notice to you.",
        "We do not use or transfer the data for personalized advertising, or to determine creditworthiness or for lending.",
        "People do not read the data, except with your permission for specific items, for security, to follow the law, or when it is anonymized and aggregated for internal operations.",
      ],
      link: { label: "Chrome Web Store user data policy", href: CHROME_USER_DATA_POLICY_URL },
    },
    {
      heading: "Extension permissions",
      paragraphs: [
        "These are the permissions the extension asks for and the only reasons it uses them:",
      ],
      table: {
        head: ["Permission", "Why the extension needs it"],
        rows: [
          [
            "Access to all websites (host permissions and content scripts)",
            "Job applications live on thousands of company sites and applicant-tracking systems, so Acorn has to read and fill the application form wherever you open one, including forms inside embedded frames. It acts only when you start it.",
          ],
          [
            "activeTab and scripting",
            "To read the page you are on and to fill and click its fields when you ask.",
          ],
          [
            "debugger",
            "To take screenshots of the page and send real mouse and keyboard input for the Agent Run. It is attached only to the tab that is running, and detached when the run ends.",
          ],
          [
            "webNavigation",
            "To notice when a job site moves to a new page or frame in the middle of an application, so the next step works on the page that is actually showing.",
          ],
          ["sidePanel", "To show the Acorn controls, progress, and logs beside the page."],
          [
            "storage and unlimitedStorage",
            "To keep your settings, the per-tab state of a run, and the local run log on your device.",
          ],
          ["alarms", "To keep a long run going and to check on it while the browser is idle."],
        ],
      },
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
        "Service providers that help us run Acorn, such as hosting, payment processing, and AI model providers (through OpenRouter) that process resume, job-posting, and page content to generate answers. They may use the data only to provide their service.",
        "Employers and job sites, but only the application details you choose to submit through the extension.",
        "Authorities, when the law requires it.",
      ],
    },
    {
      heading: "Storage and security",
      paragraphs: [
        "Data is stored on servers we control or rent from reputable hosting providers and is encrypted in transit. Google access tokens are stored encrypted and used only to carry out the features you enabled. Runs are planned in server memory and are not written to disk. No system is perfectly secure, but we work to protect your data from unauthorized access.",
      ],
    },
    {
      heading: "Retention, deletion, and your choices",
      items: [
        "Stop the extension from acting at any time: press Stop in the side panel, or remove the extension.",
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
        `${BRAND} provides a website and browser extension that help you tailor resumes, fill in job applications, and track replies. The extension can read the page you are on, fill its fields, and click its controls for you when you start it. You must be at least 16 and able to form a binding contract.`,
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
        `You own your resumes, profile, and other content. You give ${BRAND} permission to process it to provide the service, including sending it to AI model providers and to the employers and sites you choose to apply to. You are responsible for the accuracy of what is submitted in your name. ${BRAND} writes answers with AI, which can be wrong: review generated resumes and answers before relying on them, and turn on "Stop before Submit" when you want to check an application before it is sent. ${BRAND} does not guarantee interviews, offers, or any hiring outcome.`,
      ],
    },
    {
      heading: "AI and your OpenRouter key",
      paragraphs: [
        `${BRAND} runs its AI features on the OpenRouter key you add to your profile. You are responsible for that key, for the costs OpenRouter charges you, and for following OpenRouter's and the model providers' terms. ${BRAND} shows the cost of the calls it makes, but does not control what your provider bills.`,
      ],
    },
    {
      heading: "Acceptable use",
      items: [
        "Do not use the service to submit false or misleading information, or to apply on behalf of someone who has not authorized you.",
        "Do not break the terms of the job sites you apply to, or use the service to spam, scrape, or harm others. You are responsible for checking that a site allows automated help with your own application.",
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
        `The service is provided "as is" and "as available", without warranties of any kind. To the fullest extent the law allows, ${BRAND} is not liable for indirect or consequential damages, for lost opportunities, or for the actions of the job sites you apply to, and its total liability is limited to the amount you paid in the 12 months before the claim.`,
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
