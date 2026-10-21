// A guess at the job site's system (the applicant-tracking software behind the page) from the link's host
// alone, used only to group the report's rows. It decides nothing in the agent, which reads the page.

const SYSTEMS: readonly [system: string, hostPart: string][] = [
  ["Workday", "myworkdayjobs."],
  ["Workday", "workday."],
  ["Greenhouse", "greenhouse.io"],
  ["Lever", "lever.co"],
  ["iCIMS", "icims.com"],
  ["SmartRecruiters", "smartrecruiters.com"],
  ["Ashby", "ashbyhq.com"],
  ["Taleo", "taleo.net"],
  ["SuccessFactors", "successfactors."],
  ["ADP", "adp.com"],
  ["BambooHR", "bamboohr.com"],
  ["Jobvite", "jobvite.com"],
  ["Workable", "workable.com"],
  ["Rippling", "rippling.com"],
  ["Paylocity", "paylocity.com"],
  ["UKG", "ultipro.com"],
  ["Dayforce", "dayforcehcm.com"],
  ["Oracle", "oraclecloud.com"],
  ["LinkedIn", "linkedin.com"],
  ["Indeed", "indeed.com"],
];

/** The system behind a host, or "Other". */
export function siteSystem(host: string): string {
  const lower = host.toLowerCase();
  return SYSTEMS.find(([, part]) => lower.includes(part))?.[0] ?? "Other";
}
