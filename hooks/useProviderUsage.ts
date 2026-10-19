"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isProviderUsageId } from "@/lib/provider-usage-ids";

// Shapes mirror `lib/provider-usage.ts` (server-side) but are redeclared here:
// importing that module for its types would drag `ModelRuntime` into the
// client bundle. The query itself always goes through /api/provider-usage/query.
export type UsageBucket = {
  id: string;
  label: string;
  groupLabel?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  unit: "percent" | "currency" | "count";
  currency?: string;
  windowMinutes?: number;
  resetsAt?: number;
  period?: string;
};

export type UsageMetric = { id: string; label: string; value: number | string; unit?: string; currency?: string };

export type UsageReport = {
  providerId: string;
  providerName: string;
  capturedAt: number;
  buckets: UsageBucket[];
  metrics: UsageMetric[];
  notes?: string[];
};

export type UsageResponse = {
  providerId: string;
  status: "ready" | "auth-unavailable" | "query-failed";
  report?: UsageReport;
  message?: string;
};

export const PROVIDER_USAGE_STORAGE_PREFIX = "pi-web:provider-usage:";

export interface ProviderUsageOptions {
  /** Whether a refresh button may be used (provider signed in / configured). */
  enabled?: boolean;
  /** Query on open instead of waiting for a click; cached snapshots younger
   *  than `staleMs` are reused as-is. */
  auto?: boolean;
  staleMs?: number;
}

export interface ProviderUsageState {
  /** False for providers without an official usage endpoint — callers usually render nothing. */
  supported: boolean;
  report?: UsageReport;
  querying: boolean;
  error: string | null;
  /** True for ~2s after a successful refresh, for the checkmark flourish. */
  refreshDone: boolean;
  refresh: () => void;
}

export function useProviderUsage(providerId: string, options: ProviderUsageOptions = {}): ProviderUsageState {
  const { enabled = true, auto = false, staleMs = 60_000 } = options;
  const supported = isProviderUsageId(providerId);
  const [snapshot, setSnapshot] = useState<UsageResponse | null>(null);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshDone, setRefreshDone] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRef = useRef<UsageResponse | null>(null);
  const autoRequestedRef = useRef<string | null>(null);
  const { t } = useI18n();

  // Load the last snapshot for this provider; it is the same cache the models
  // settings page writes, so both views agree without a second query.
  useEffect(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setRefreshDone(false);
    setSnapshot(null);
    snapshotRef.current = null;
    autoRequestedRef.current = null;
    try {
      const cached = localStorage.getItem(`${PROVIDER_USAGE_STORAGE_PREFIX}${providerId}`);
      if (cached) {
        const parsed = JSON.parse(cached) as UsageResponse;
        if (parsed?.status === "ready" && parsed.report && Array.isArray(parsed.report.buckets) && Array.isArray(parsed.report.metrics)) {
          setSnapshot(parsed);
          snapshotRef.current = parsed;
        }
      }
    } catch {
      try { localStorage.removeItem(`${PROVIDER_USAGE_STORAGE_PREFIX}${providerId}`); } catch { /* storage unavailable */ }
    }
    setError(null);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [providerId]);

  const query = useCallback(async () => {
    setQuerying(true);
    setError(null);
    try {
      const response = await fetch("/api/provider-usage/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const result = await response.json() as UsageResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      if (result.status === "ready") {
        setSnapshot(result);
        snapshotRef.current = result;
        try { localStorage.setItem(`${PROVIDER_USAGE_STORAGE_PREFIX}${providerId}`, JSON.stringify(result)); } catch { /* storage unavailable */ }
        setRefreshDone(true);
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => setRefreshDone(false), 2000);
      } else {
        setError(result.message ?? t("providerUsage.queryFailed"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("providerUsage.queryFailed"));
    } finally {
      setQuerying(false);
    }
  }, [providerId, t]);

  // Auto-query once per provider while the view is open, skipping it while the
  // cached snapshot is fresh enough. `autoRequestedRef` keeps this to one query
  // per provider even though the state updates re-render the effect.
  useEffect(() => {
    if (!auto || !supported || !enabled) return;
    if (autoRequestedRef.current === providerId) return;
    const cached = snapshotRef.current;
    if (cached?.status === "ready" && Date.now() - (cached.report?.capturedAt ?? 0) < staleMs) return;
    autoRequestedRef.current = providerId;
    void query();
  }, [auto, enabled, providerId, query, staleMs, supported]);

  return {
    supported,
    report: snapshot?.status === "ready" ? snapshot.report : undefined,
    querying,
    error,
    refreshDone,
    refresh: () => { void query(); },
  };
}