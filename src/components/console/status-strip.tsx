"use client";

import { useEffect, useState } from "react";

import { StatusDot } from "@/components/meshsync/status-dot";
import { useDevice, useEvents, useHealth, useTransfers } from "@/hooks/use-agent-data";
import { useI18n } from "@/lib/i18n";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

/** Bottom status strip — the app footer (mt-auto semantics, h-9). */
export function StatusStrip() {
  const { t, fmt } = useI18n();
  const port = useConsoleStore((s) => s.selectedAgentPort);
  const wsState = useConsoleStore((s) => s.wsState);
  const health = useHealth(port);
  const device = useDevice(port);
  const transfers = useTransfers(port);
  const events = useEvents(port);

  // 1s repaint for the live uptime counter (real uptime + measured elapsed).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  // Single global recorder of real speed samples (sparkline ring buffer).
  const transferData = transfers.data;
  useEffect(() => {
    if (!transferData) return;
    const store = useConsoleStore.getState();
    for (const tr of transferData.transfers) {
      if (tr.status === "TRANSFERRING" && tr.speedBps > 0) {
        store.pushSpeedSample(tr.id, tr.speedBps);
      }
    }
  }, [transferData]);

  const engineOk = health.data?.status === "ok" && !health.isError;

  const uptime = health.data
    ? health.data.uptimeSeconds + Math.max(0, Date.now() - health.dataUpdatedAt) / 1000
    : null;

  const active = (transfers.data?.transfers ?? []).filter(
    (tr) =>
      tr.status === "TRANSFERRING" ||
      tr.status === "PREPARING" ||
      tr.status === "VERIFYING" ||
      tr.status === "QUEUED"
  );
  const activeMoving = active.filter((tr) => tr.status === "TRANSFERRING");
  const aggregateSpeed = activeMoving.reduce((sum, tr) => sum + tr.speedBps, 0);
  const lastEvent = events.data?.[0] ?? null;

  const wsLabel =
    wsState === "live"
      ? t("topbar.live")
      : wsState === "reconnecting"
        ? t("topbar.reconnecting")
        : wsState === "connecting"
          ? t("topbar.connecting")
          : "—";

  const deviceName = device.data?.name ?? `:${port}`;

  return (
    <footer
      className={cn(
        "mt-auto flex h-9 shrink-0 items-center gap-3 border-t bg-background/90 px-3 text-xs text-muted-foreground backdrop-blur sm:px-4"
      )}
    >
      {/* left: engine + device + version + uptime */}
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot
          tone={engineOk ? "emerald" : "stone"}
          pulse={engineOk}
          label={engineOk ? t("statusbar.engineOk") : t("statusbar.engineDown")}
        />
        <span
          className="hidden min-w-0 items-center gap-1.5 md:inline-flex"
          dir="auto"
        >
          <span className="truncate font-medium text-foreground">{deviceName}</span>
          {health.data ? (
            <span className="font-mono text-[11px]" dir="ltr">
              v{health.data.version}
            </span>
          ) : null}
          {uptime !== null ? (
            <span className="font-mono text-[11px]" dir="ltr">
              · {fmt.uptime(uptime)}
            </span>
          ) : null}
        </span>
      </div>

      {/* center: transfers + speed + last event ticker */}
      <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
        <span className="shrink-0 whitespace-nowrap" dir="auto">
          {active.length > 0
            ? t("statusbar.activeTransfers", { count: active.length })
            : t("statusbar.noTransfers")}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-foreground/80" dir="ltr">
          {fmt.speed(aggregateSpeed)}
        </span>
        {lastEvent ? (
          <span className="min-w-0 flex-1 truncate" title={lastEvent.message}>
            <span className="sr-only">{t("statusbar.lastEvent")}: </span>
            {lastEvent.message}
          </span>
        ) : null}
      </div>

      <div className="flex-1 lg:hidden" />

      {/* right: copyright + WS state */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden font-mono text-[11px] sm:inline" dir="ltr">
          WS {wsLabel}
        </span>
        <span className="hidden sm:inline">{t("statusbar.copyright")}</span>
      </div>
    </footer>
  );
}
