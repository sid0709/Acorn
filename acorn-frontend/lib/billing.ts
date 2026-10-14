import { addDays, type Day } from "./workspace/dates";

/**
 * Plans, limits, and the usage window. No payment provider is connected yet, so every
 * account is on Free and checkout buttons stay off until one is.
 */

export type BillingInterval = "monthly" | "yearly";
export type PlanId = "free" | "pro" | "unlimited";

/** null means no limit. */
export type PlanLimits = {
  applications: number | null;
  drafts: number | null;
  mailboxes: number | null;
};

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Whole dollars per month for each interval; yearly is billed once a year. */
  price: Record<BillingInterval, number>;
  limits: PlanLimits;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try Acorn on a handful of postings.",
    price: { monthly: 0, yearly: 0 },
    limits: { applications: 30, drafts: 3, mailboxes: 1 },
    features: [
      "30 applications a month",
      "3 resume drafts a month",
      "1 Gmail mailbox",
      "Statistics",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For an active search.",
    price: { monthly: 19, yearly: 15 },
    limits: { applications: 300, drafts: 50, mailboxes: 3 },
    features: [
      "300 applications a month",
      "50 resume drafts a month",
      "3 Gmail mailboxes",
      "Gmail auto-label",
      "Autofill on every supported job site",
    ],
  },
  {
    id: "unlimited",
    name: "Unlimited",
    tagline: "No caps, the best models first.",
    price: { monthly: 39, yearly: 31 },
    limits: { applications: null, drafts: null, mailboxes: 10 },
    features: [
      "Unlimited applications",
      "Unlimited resume drafts",
      "10 Gmail mailboxes",
      "Priority AI models",
      "Early access to new features",
    ],
  },
];

/** Usage is counted over the last this-many days. */
export const BILLING_CYCLE_DAYS = 30;
const MONTHS_PER_YEAR = 12;

/** The plan every account is on until a payment provider reports the real one. */
export const CURRENT_PLAN_ID: PlanId = "free";

export function planById(id: PlanId) {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

/** "$19" or "$0". */
export function formatPrice(dollars: number) {
  return `$${dollars.toLocaleString()}`;
}

export function yearlySaving(plan: Plan) {
  return (plan.price.monthly - plan.price.yearly) * MONTHS_PER_YEAR;
}

export type Cycle = { start: Day };

/** The usage window ending today: the last BILLING_CYCLE_DAYS days. */
export function currentCycle(today: Day): Cycle {
  return { start: addDays(today, -(BILLING_CYCLE_DAYS - 1)) };
}
