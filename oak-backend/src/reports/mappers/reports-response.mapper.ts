export type JobSourceSummaryRow = {
  source: string;
  postings: number;
  applied: number;
  scheduled: number;
  declined: number;
};

export type DailyCountRow = {
  date: string;
  value: number;
};

export type DailyPostingBySourceRow = {
  date: string;
  source: string;
  count: number;
};

export type DailyPostingBySourceAndScrapeRow = {
  date: string;
  source: string;
  scrapeSource: string;
  count: number;
};

export function okReportData<T>(data: T[]) {
  return { success: true as const, data };
}
