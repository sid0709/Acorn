import { useCallback, useEffect, useState } from "react";
import { authHeaders, getAcornApiUrl } from "../auth/acorn-auth";
import { usageTabKey } from "../tab-usage-key";

const USAGE_POLL_MS = 4_000;

export type AiUsageEntry = {
  id: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  price: string;
  priced: boolean;
  createdAt: string;
};

export function formatUsagePrice(price: string | null | undefined): string {
  if (!price) return "—";
  const [wholeRaw, fracRaw = ""] = price.split(".");
  if (!/^\d+$/.test(wholeRaw) || (fracRaw !== "" && !/^\d+$/.test(fracRaw))) return "—";
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const trimmed = fracRaw.replace(/0+$/, "");
  const frac = trimmed.length < 2 ? `${trimmed}00`.slice(0, 2) : trimmed.slice(0, 8);
  return `$${whole}.${frac}`;
}

/** This Chrome tab's AI calls. A different tab has a different list. */
export function useAiUsage(tabId: number | null, active: boolean, signedIn: boolean) {
  const [entries, setEntries] = useState<AiUsageEntry[]>([]);
  const [totalPrice, setTotalPrice] = useState("0.000000000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (tabId == null || !signedIn) {
      setEntries([]);
      setTotalPrice("0.000000000");
      setError(null);
      return;
    }
    try {
      const key = await usageTabKey(tabId);
      const base = (await getAcornApiUrl()).replace(/\/$/, "");
      const res = await fetch(`${base}/acorn/ai-usage?tab=${encodeURIComponent(key)}`, {
        headers: await authHeaders(tabId),
      });
      const data = (await res.json().catch(() => ({}))) as {
        entries?: AiUsageEntry[];
        totalPrice?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || data.message || `Usage failed (${res.status})`);
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setTotalPrice(typeof data.totalPrice === "string" ? data.totalPrice : "0.000000000");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [signedIn, tabId]);

  useEffect(() => {
    if (!active || !signedIn || tabId == null) return;
    setEntries([]);
    setTotalPrice("0.000000000");
    setError(null);
    setLoading(true);
    void load().finally(() => setLoading(false));
    const timer = window.setInterval(() => {
      void load();
    }, USAGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, load, signedIn, tabId]);

  const reload = useCallback(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  return { entries, totalPrice, loading, error, reload };
}
