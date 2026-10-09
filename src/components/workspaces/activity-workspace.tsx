"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Radio, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/meshsync/empty-state";
import { EnumBadge, type BadgeTone } from "@/components/meshsync/enum-badge";
import { StatusDot, severityTone } from "@/components/meshsync/status-dot";
import {
  InlineError,
  LoadingRows,
  WorkspaceHeader,
} from "@/components/workspaces/shared";
import { useEvents, useLoadMoreEvents } from "@/hooks/use-agent-data";
import { useI18n } from "@/lib/i18n";
import type { AgentEvent, EventSeverity, EventType } from "@/lib/types";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

const EVENT_TYPES: ReadonlyArray<EventType> = [
  "PEER_DISCOVERED",
  "PAIR_REQUESTED",
  "PAIR_APPROVED",
  "PEER_REVOKED",
  "PEER_ONLINE",
  "PEER_OFFLINE",
  "SYNC_STARTED",
  "SYNC_COMPLETED",
  "SYNC_FAILED",
  "TRANSFER_STARTED",
  "TRANSFER_PROGRESS",
  "TRANSFER_COMPLETED",
  "TRANSFER_FAILED",
  "TRANSFER_PAUSED",
  "TRANSFER_RESUMED",
  "TRANSFER_CANCELLED",
  "CONFLICT_DETECTED",
  "CONFLICT_RESOLVED",
  "FILE_INDEXED",
  "FILE_CHANGED",
  "FILE_DELETED",
  "FOLDER_ADDED",
  "FOLDER_REMOVED",
  "SETTINGS_UPDATED",
  "NATIVE_FALLBACK",
];

function severityBadgeTone(severity: EventSeverity): BadgeTone {
  switch (severity) {
    case "ERROR":
      return "red";
    case "WARN":
      return "amber";
    default:
      return "emerald";
  }
}

function EventRow({ event }: { event: AgentEvent }) {
  const { t, fmt } = useI18n();
  const [dataOpen, setDataOpen] = useState(false);
  const hasData = event.data && Object.keys(event.data).length > 0;

  return (
    <article className="border-b last:border-b-0">
      <div className="flex items-baseline gap-2 px-3 py-2.5">
        <StatusDot
          tone={severityTone(event.severity)}
          className="translate-y-[-1px] self-center"
          label={event.severity}
        />
        <EnumBadge value={event.type} tone={severityBadgeTone(event.severity)} />
        <p className="min-w-0 flex-1 text-xs leading-5 text-foreground" dir="auto">
          {event.message}
        </p>
        <span
          className="shrink-0 text-[11px] text-muted-foreground"
          title={fmt.dateTime(event.ts)}
        >
          {fmt.relative(event.ts)}
        </span>
        {hasData ? (
          <button
            type="button"
            onClick={() => setDataOpen((v) => !v)}
            aria-expanded={dataOpen}
            aria-label={t("activity.eventData")}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform rtl-flip",
                dataOpen && "rotate-90"
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden="true" />
        )}
      </div>
      {hasData && dataOpen ? (
        <pre
          className="mx-3 mb-2 max-h-40 overflow-auto rounded-md border bg-secondary/40 p-2.5 font-mono text-[11px] whitespace-pre-wrap break-all"
          dir="ltr"
        >
          {JSON.stringify(event.data, null, 2)}
        </pre>
      ) : null}
    </article>
  );
}

type SeverityFilter = "all" | EventSeverity;

export function ActivityWorkspace({ port }: { port: number }) {
  const { t } = useI18n();
  const events = useEvents(port);
  const loadMore = useLoadMoreEvents(port);
  const wsState = useConsoleStore((s) => s.wsState);

  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [type, setType] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  const all = events.data ?? [];

  const counts = useMemo(() => {
    const c = { all: all.length, INFO: 0, WARN: 0, ERROR: 0 };
    for (const e of all) c[e.severity] += 1;
    return c;
  }, [all]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (e) =>
        (severity === "all" || e.severity === severity) &&
        (type === "ALL" || e.type === type) &&
        (q === "" || e.message.toLowerCase().includes(q))
    );
  }, [all, severity, type, query]);

  const severityChips: ReadonlyArray<{
    id: SeverityFilter;
    labelKey:
      | "activity.severity.all"
      | "activity.severity.info"
      | "activity.severity.warn"
      | "activity.severity.error";
    count: number;
  }> = [
    { id: "all", labelKey: "activity.severity.all", count: counts.all },
    { id: "INFO", labelKey: "activity.severity.info", count: counts.INFO },
    { id: "WARN", labelKey: "activity.severity.warn", count: counts.WARN },
    { id: "ERROR", labelKey: "activity.severity.error", count: counts.ERROR },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 py-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          <WorkspaceHeader
            title={t("activity.title")}
            desc={
              <span className="flex flex-wrap items-center gap-x-3">
                {wsState === "live" ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <Radio className="size-3" aria-hidden="true" />
                    {t("activity.live")}
                  </span>
                ) : null}
                <span dir="auto">
                  {t("activity.count", { count: filtered.length })}
                </span>
              </span>
            }
          />

          {/* filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("activity.severity")} className="flex flex-wrap gap-1.5">
              {severityChips.map((chip) => {
                const active = severity === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSeverity(chip.id)}
                    className={cn(
                      "inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-transparent bg-secondary text-secondary-foreground hover:bg-accent"
                    )}
                  >
                    {t(chip.labelKey)}
                    <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">
                      {chip.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <Select value={type} onValueChange={setType}>
              <SelectTrigger
                className="h-9 w-44 font-mono text-xs"
                aria-label={t("activity.type")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="ALL">{t("activity.allTypes")}</SelectItem>
                {EVENT_TYPES.map((et) => (
                  <SelectItem key={et} value={et} className="font-mono text-xs">
                    {et}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative min-w-40 flex-1">
              <Search
                className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("activity.searchPlaceholder")}
                className="h-9 ps-8 text-xs"
                aria-label={t("common.search")}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4 sm:px-6">
        <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
          {events.isLoading ? <LoadingRows rows={6} /> : null}
          {events.isError ? <InlineError error={events.error} /> : null}

          {events.data && all.length === 0 ? (
            <EmptyState
              kind="activity"
              title={t("activity.noEvents")}
              hint={t("activity.noEventsHint")}
            />
          ) : null}

          {all.length > 0 && filtered.length === 0 ? (
            <EmptyState
              kind="activity"
              title={t("activity.noMatch")}
              hint={t("common.noResults")}
            />
          ) : null}

          {filtered.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card">
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filtered.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
              <div className="shrink-0 border-t p-2">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={events.isFetching}
                  className="w-full rounded-md py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {events.isFetching ? t("common.loading") : t("common.loadMore")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
