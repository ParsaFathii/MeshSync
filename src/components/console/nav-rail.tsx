"use client";

import {
  Activity,
  ArrowUpDown,
  FileSearch,
  FolderTree,
  Gauge,
  Network,
  RefreshCw,
  Settings2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { useI18n, type DictKey } from "@/lib/i18n";
import { handleRovingKeyDown } from "@/lib/roving";
import { useConsoleStore, type Workspace } from "@/state/console";
import { cn } from "@/lib/utils";

const WORKSPACES: ReadonlyArray<{
  id: Workspace;
  labelKey: DictKey;
  icon: LucideIcon;
}> = [
  { id: "device", labelKey: "nav.device", icon: Gauge },
  { id: "peers", labelKey: "nav.peers", icon: Network },
  { id: "folders", labelKey: "nav.folders", icon: FolderTree },
  { id: "files", labelKey: "nav.files", icon: FileSearch },
  { id: "sync", labelKey: "nav.sync", icon: RefreshCw },
  { id: "transfers", labelKey: "nav.transfers", icon: ArrowUpDown },
  { id: "conflicts", labelKey: "nav.conflicts", icon: TriangleAlert },
  { id: "activity", labelKey: "nav.activity", icon: Activity },
  { id: "settings", labelKey: "nav.settings", icon: Settings2 },
];

function NavItem({
  id,
  labelKey,
  icon: Icon,
  index,
  layout,
}: {
  id: Workspace;
  labelKey: DictKey;
  icon: LucideIcon;
  index: number;
  layout: "rail" | "strip";
}) {
  const { t } = useI18n();
  const activeWorkspace = useConsoleStore((s) => s.activeWorkspace);
  const setActiveWorkspace = useConsoleStore((s) => s.setActiveWorkspace);
  const active = activeWorkspace === id;
  const label = t(labelKey);

  return (
    <button
      type="button"
      data-roving-index={index}
      aria-current={active ? "page" : undefined}
      tabIndex={active ? 0 : -1}
      onClick={() => setActiveWorkspace(id)}
      title={label}
      className={cn(
        "group relative flex min-h-[44px] items-center justify-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        layout === "rail"
          ? "w-full flex-col px-1 py-2 xl:flex-row xl:justify-start xl:gap-3 xl:px-3"
          : "shrink-0 flex-row gap-2 whitespace-nowrap px-3 py-2",
        active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute rounded-full bg-primary",
            layout === "rail"
              ? "start-0 inset-y-2 w-[3px]"
              : "inset-x-2 bottom-0 h-[3px]"
          )}
        />
      )}
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          layout === "rail"
            ? "text-[10px] leading-tight xl:text-sm xl:font-medium"
            : "text-sm font-medium"
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** Left navigation rail (desktop) / horizontal scrollable tab strip (mobile). */
export function NavRail() {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("nav.workspaces")}
      onKeyDown={handleRovingKeyDown}
      className="hidden shrink-0 flex-col gap-1 border-e bg-card/40 p-2 md:flex md:w-20 xl:w-56"
    >
      {WORKSPACES.map((ws, i) => (
        <NavItem key={ws.id} {...ws} index={i} layout="rail" />
      ))}
    </nav>
  );
}

/** Mobile: horizontal scrollable tab strip below the top bar. */
export function NavStrip() {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("nav.workspaces")}
      onKeyDown={handleRovingKeyDown}
      className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background px-2 py-1.5 md:hidden"
    >
      {WORKSPACES.map((ws, i) => (
        <NavItem key={ws.id} {...ws} index={i} layout="strip" />
      ))}
    </nav>
  );
}
