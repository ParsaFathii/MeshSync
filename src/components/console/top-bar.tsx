"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { MeshSyncLogoLockup } from "@/components/meshsync/logo";
import { StatusDot } from "@/components/meshsync/status-dot";
import { useHealth } from "@/hooks/use-agent-data";
import { useAgentEndpoints } from "@/hooks/use-web-api";
import { useI18n } from "@/lib/i18n";
import { handleRovingKeyDown } from "@/lib/roving";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

function AgentChip({
  label,
  port,
  index,
}: {
  label: string;
  port: number;
  index: number;
}) {
  const { t } = useI18n();
  const selectedPort = useConsoleStore((s) => s.selectedAgentPort);
  const setSelectedPort = useConsoleStore((s) => s.setSelectedAgentPort);
  const health = useHealth(port);
  const selected = selectedPort === port;

  const online = !health.isError && health.data?.status === "ok";

  return (
    <button
      type="button"
      role="tab"
      data-roving-index={index}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      aria-label={`${t("topbar.deviceContext")}: ${label} (${port})`}
      onClick={() => setSelectedPort(port)}
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <StatusDot tone={online ? "emerald" : "stone"} pulse={online && selected} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Top bar: logo/wordmark, device context switcher, live WS + language + theme. */
export function TopBar() {
  const { t, lang, setLang } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const wsState = useConsoleStore((s) => s.wsState);
  const registry = useAgentEndpoints();
  const agents = registry.data ?? [];

  const wsLive = wsState === "live";
  const wsLabel =
    wsState === "live"
      ? t("topbar.live")
      : wsState === "reconnecting"
        ? t("topbar.reconnecting")
        : t("topbar.connecting");

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:gap-3 sm:px-4">
      <MeshSyncLogoLockup size={26} wordmarkClassName="hidden text-[15px] sm:inline" />

      {/* device context switcher — tablist semantics, roving keyboard nav */}
      <div
        role="tablist"
        aria-label={t("topbar.deviceContext")}
        onKeyDown={handleRovingKeyDown}
        className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto"
      >
        {agents.length === 0 ? (
          <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
            {registry.isLoading ? "…" : "—"}
          </span>
        ) : (
          agents.map((agent, i) => (
            <AgentChip
              key={agent.id}
              label={agent.label}
              port={agent.port}
              index={i}
            />
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* live WS indicator */}
        <span
          className="hidden items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline-flex"
          title={wsLive ? t("topbar.wsLive") : t("topbar.wsReconnecting")}
          role="status"
          aria-live="polite"
        >
          <StatusDot tone={wsLive ? "emerald" : "stone"} pulse={wsLive} />
          <span className="hidden md:inline">{wsLabel}</span>
        </span>

        {/* language toggle EN / فارسی */}
        <div
          className="inline-flex items-center rounded-md border p-0.5"
          role="group"
          aria-label={t("topbar.language")}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={lang === "en"}
            onClick={() => setLang("en")}
            className={cn(
              "h-7 rounded-sm px-2 text-xs font-medium",
              lang === "en" && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
          >
            EN
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={lang === "fa"}
            onClick={() => setLang("fa")}
            className={cn(
              "h-7 rounded-sm px-2 text-xs font-medium",
              lang === "fa" && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
          >
            فارسی
          </Button>
        </div>

        {/* theme toggle */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-9"
          aria-label={t("topbar.toggleTheme")}
          title={t("topbar.theme")}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="size-4.5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" aria-hidden="true" />
          <Moon className="absolute size-4.5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
