"use client";

import { useI18n } from "@/hooks/useI18n";
import { formatUpdatedTime } from "@/lib/i18n/format";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import { useProviderUsage, type UsageBucket, type UsageMetric } from "@/hooks/useProviderUsage";

export function ProviderUsageSummary({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  if (!isProviderUsageId(providerId)) return null;
  return <ProviderUsageContent providerId={providerId} enabled={enabled} />;
}

function ProviderUsageContent({ providerId, enabled }: { providerId: string; enabled: boolean }) {
  const { report, querying, error, refreshDone, refresh } = useProviderUsage(providerId, { enabled });
  const { locale, t } = useI18n();

  return (
    <section style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600, lineHeight: 1.35 }}>{t("providerUsage.usage")}</span>
        <RefreshButton enabled={enabled} querying={querying} refreshDone={refreshDone} onClick={refresh} />
        {report && (
          <span title={new Date(report.capturedAt).toLocaleString(locale)} style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
            {t("providerUsage.updated", { time: formatUpdatedTime(report.capturedAt, locale) })}
          </span>
        )}
      </div>

      {!report && !error && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("providerUsage.notQueried")}</span>}
      {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
      {report && (
        <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr)", columnGap: 14, rowGap: 8, alignItems: "baseline", minWidth: 0, width: "min(100%, 420px)", maxWidth: "100%", fontSize: 12 }}>
          {report.buckets.map((bucket) => (
            <div key={bucket.id} style={{ display: "contents" }}>
              <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label}</span>
              <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatBucket(bucket, t("providerUsage.available"))}</span>
            </div>
          ))}
          {report.metrics.map((metric) => (
            <div key={metric.id} style={{ display: "contents" }}>
              <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{metric.label}</span>
              <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatMetric(metric)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Compact provider limits for the session-info popover: the same official usage
 * query the models settings page runs, laid out like the popover's other
 * sections. Renders nothing for providers without a usage endpoint.
 */
export function ProviderUsageLimits({ providerId }: { providerId: string | null | undefined }) {
  if (!providerId || !isProviderUsageId(providerId)) return null;
  return <ProviderUsageLimitsContent providerId={providerId} />;
}

function ProviderUsageLimitsContent({ providerId }: { providerId: string }) {
  const { report, querying, error, refreshDone, refresh } = useProviderUsage(providerId, { auto: true });
  const { locale, t } = useI18n();

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{t("session.limits")}</span>
        {report && <span style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{report.providerName}</span>}
        <RefreshButton enabled querying={querying} refreshDone={refreshDone} onClick={refresh} small />
        {report && (
          <span title={new Date(report.capturedAt).toLocaleString(locale)} style={{ fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
            {formatUpdatedTime(report.capturedAt, locale)}
          </span>
        )}
      </div>

      {!report && !error && !querying && <div style={{ color: "var(--text-dim)" }}>{t("providerUsage.notQueried")}</div>}
      {error && <div style={{ color: "#f87171", overflowWrap: "anywhere" }}>{error}</div>}
      {report && (
        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 12, rowGap: 4 }}>
          {report.buckets.map((bucket) => (
            <div key={bucket.id} style={{ display: "contents" }}>
              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{bucket.groupLabel ? `${bucket.groupLabel} / ${bucket.label}` : bucket.label}</div>
              <div style={{ color: "var(--text-muted)", minWidth: 0, overflowWrap: "anywhere", whiteSpace: "normal" }}>{formatBucket(bucket, t("providerUsage.available"))}</div>
            </div>
          ))}
          {report.metrics.map((metric) => (
            <div key={metric.id} style={{ display: "contents" }}>
              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{metric.label}</div>
              <div style={{ color: "var(--text-muted)", minWidth: 0, overflowWrap: "anywhere", whiteSpace: "normal" }}>{formatMetric(metric)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RefreshButton({ enabled, querying, refreshDone, onClick, small = false }: {
  enabled: boolean;
  querying: boolean;
  refreshDone: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  const { t } = useI18n();
  const size = small ? 22 : 32;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled || querying}
      title={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
      aria-label={t(querying ? "providerUsage.refreshing" : "providerUsage.refresh")}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: small ? size : 30,
        padding: 0,
        background: "none",
        border: "none",
        color: refreshDone ? "#4ade80" : "var(--text-dim)",
        cursor: enabled && !querying ? "pointer" : "default",
        borderRadius: 5,
        flexShrink: 0,
        opacity: enabled ? 1 : 0.6,
        transition: "color 0.3s",
      }}
    >
      {refreshDone ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={querying ? { animation: "spin 0.8s linear infinite" } : undefined} aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      )}
    </button>
  );
}

function formatBucket(bucket: UsageBucket, availableLabel: string): string {
  if (bucket.unit === "percent" && bucket.remaining !== undefined) {
    const reset = bucket.resetsAt ? ` / ${formatReset(bucket.resetsAt)}` : "";
    return `${Math.round(bucket.remaining)}%${reset}`;
  }
  if (bucket.unit === "currency") return `${bucket.currency === "CNY" ? "CNY " : "$"}${formatAmount(bucket.remaining ?? bucket.limit)}`;
  if (bucket.remaining !== undefined && bucket.limit !== undefined) return `${formatAmount(bucket.remaining)} / ${formatAmount(bucket.limit)}`;
  return bucket.period ?? availableLabel;
}

function formatMetric(metric: UsageMetric): string {
  if (metric.unit === "currency") return `${metric.currency === "CNY" ? "CNY " : "$"}${metric.value}`;
  return String(metric.value);
}

function formatAmount(value: number | undefined): string {
  return value === undefined ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatReset(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}