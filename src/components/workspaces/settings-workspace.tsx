"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/meshsync/empty-state";
import {
  InlineError,
  LoadingRows,
  SectionCard,
  WorkspaceHeader,
  toastAgentError,
} from "@/components/workspaces/shared";
import { useHealth, useSettings } from "@/hooks/use-agent-data";
import * as api from "@/lib/agent-api";
import { useI18n, persistPref } from "@/lib/i18n";
import { qk } from "@/lib/query-keys";
import type { Settings } from "@/lib/types";
import { useConsoleStore } from "@/state/console";
import { cn } from "@/lib/utils";

const CHUNK_SIZES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 65_536, label: "64 KiB" },
  { value: 262_144, label: "256 KiB" },
  { value: 1_048_576, label: "1 MiB" },
  { value: 4_194_304, label: "4 MiB" },
  { value: 16_777_216, label: "16 MiB" },
];

const AUTO_SYNC_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: "off" },
  { value: 30, label: "30s" },
  { value: 60, label: "1m" },
  { value: 300, label: "5m" },
  { value: 900, label: "15m" },
];

type BandwidthMode = "unlimited" | "kbps" | "mbps";

interface FormState {
  deviceName: string;
  bandwidthMode: BandwidthMode;
  bandwidthValue: number;
  concurrency: number;
  chunkSize: number;
  discoveryEnabled: boolean;
  skipHiddenFiles: boolean;
  autoSyncSeconds: number;
}

function fromSettings(s: Settings): FormState {
  let bandwidthMode: BandwidthMode = "unlimited";
  let bandwidthValue = 0;
  if (s.bandwidthLimitBps > 0) {
    if (s.bandwidthLimitBps % 1_048_576 === 0) {
      bandwidthMode = "mbps";
      bandwidthValue = s.bandwidthLimitBps / 1_048_576;
    } else {
      bandwidthMode = "kbps";
      bandwidthValue = Math.max(1, Math.round(s.bandwidthLimitBps / 1024));
    }
  }
  return {
    deviceName: s.deviceName,
    bandwidthMode,
    bandwidthValue,
    concurrency: s.concurrentTransfers,
    chunkSize: s.chunkSizeBytes,
    discoveryEnabled: s.discoveryEnabled,
    skipHiddenFiles: s.skipHiddenFiles,
    autoSyncSeconds: s.autoSyncSeconds,
  };
}

function toSettings(f: FormState): Settings {
  const bandwidthLimitBps =
    f.bandwidthMode === "unlimited"
      ? 0
      : f.bandwidthMode === "kbps"
        ? Math.round(f.bandwidthValue * 1024)
        : Math.round(f.bandwidthValue * 1_048_576);
  return {
    deviceName: f.deviceName.trim(),
    bandwidthLimitBps,
    concurrentTransfers: f.concurrency,
    chunkSizeBytes: f.chunkSize,
    discoveryEnabled: f.discoveryEnabled,
    skipHiddenFiles: f.skipHiddenFiles,
    autoSyncSeconds: f.autoSyncSeconds,
  };
}

function sameForm(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function SettingsWorkspace({ port }: { port: number }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const settings = useSettings(port);
  const health = useHealth(port);
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState | null>(null);
  const [stored, setStored] = useState<Settings | null>(null);
  const [validation, setValidation] = useState<string[]>([]);

  // Derived form: the editing copy, falling back to the loaded baseline.
  const baseline = useMemo(
    () => (settings.data ? fromSettings(settings.data) : null),
    [settings.data]
  );
  const current: FormState | null = form ?? baseline;

  const update = (patch: Partial<FormState>) => {
    if (current) setForm({ ...current, ...patch });
  };

  const dirty = form !== null && baseline !== null && !sameForm(form, baseline);

  const save = useMutation({
    mutationFn: (next: Settings) => api.putSettings(port, next),
    onSuccess: (resp) => {
      queryClient.setQueryData(qk.settings(port), resp);
      void queryClient.invalidateQueries({ queryKey: qk.device(port) });
      setForm(fromSettings(resp));
      setStored(resp);
      setValidation([]);
      toast.success(t("toast.settingsSaved"));
    },
    onError: (err) => toastAgentError(err, t),
  });

  const submit = () => {
    if (!current) return;
    const errors: string[] = [];
    if (!current.deviceName.trim()) errors.push(t("settings.invalidName"));
    if (
      current.bandwidthMode !== "unlimited" &&
      (!Number.isFinite(current.bandwidthValue) || current.bandwidthValue < 1)
    ) {
      errors.push(t("settings.invalidBandwidth"));
    }
    if (
      !Number.isInteger(current.concurrency) ||
      current.concurrency < 1 ||
      current.concurrency > 16
    ) {
      errors.push(t("settings.invalidConcurrency"));
    }
    setValidation(errors);
    if (errors.length === 0) {
      save.mutate(toSettings(current));
    }
  };

  const setLangAndPersist = (next: "en" | "fa") => {
    setLang(next);
    void persistPref({ language: next });
  };

  const setThemeAndPersist = (next: string) => {
    setTheme(next);
    void persistPref({ theme: next });
  };

  if (settings.isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
          <WorkspaceHeader title={t("settings.title")} />
          <LoadingRows rows={5} />
        </div>
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
          <WorkspaceHeader title={t("settings.title")} />
          <InlineError error={settings.error} />
          <EmptyState
            kind="settings"
            title={t("settings.notLoaded")}
            hint={t("settings.notLoadedHint")}
          />
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl px-4 py-4 sm:px-6">
          <LoadingRows rows={4} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 pb-10 sm:px-6">
        <WorkspaceHeader
          title={t("settings.title")}
          actions={
            <div className="flex flex-col items-end gap-1">
              <Button
                type="button"
                onClick={submit}
                disabled={!dirty || save.isPending}
              >
                {save.isPending ? t("settings.saving") : t("settings.save")}
              </Button>
              {dirty ? (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  {t("common.unsaved")}
                </span>
              ) : null}
            </div>
          }
        />

        {validation.length > 0 ? (
          <div
            role="alert"
            className="rounded-md border border-red-600/30 bg-red-600/5 px-3 py-2 text-xs text-red-700 dark:text-red-400"
          >
            {t("settings.validation")}
            <ul className="mt-1 list-inside list-disc">
              {validation.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Identity */}
        <SectionCard title={t("settings.identity")}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-device-name">{t("settings.deviceName")}</Label>
            <Input
              id="settings-device-name"
              value={current.deviceName}
              onChange={(e) => update({ deviceName: e.target.value })}
              maxLength={64}
              className="max-w-sm"
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">
              {t("settings.deviceNameHint")}
            </p>
          </div>
        </SectionCard>

        {/* Transfer */}
        <SectionCard title={t("settings.transfer")}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-40 flex-col gap-1.5">
                <Label htmlFor="settings-bandwidth-mode">
                  {t("settings.bandwidthLimit")}
                </Label>
                <Select
                  value={current.bandwidthMode}
                  onValueChange={(v) => update({ bandwidthMode: v as BandwidthMode })}
                >
                  <SelectTrigger id="settings-bandwidth-mode" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlimited">
                      {t("settings.unlimited")}
                    </SelectItem>
                    <SelectItem value="kbps">KiB/s</SelectItem>
                    <SelectItem value="mbps">MiB/s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {current.bandwidthMode !== "unlimited" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="settings-bandwidth-value">
                    {t("settings.bandwidthUnit")}
                  </Label>
                  <Input
                    id="settings-bandwidth-value"
                    type="number"
                    min={1}
                    value={current.bandwidthValue}
                    onChange={(e) => update({ bandwidthValue: Number(e.target.value) })}
                    className="w-28 font-mono"
                    dir="ltr"
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-concurrency">
                  {t("settings.concurrency")}
                </Label>
                <Input
                  id="settings-concurrency"
                  type="number"
                  min={1}
                  max={16}
                  value={current.concurrency}
                  onChange={(e) => update({ concurrency: Number(e.target.value) })}
                  className="w-24 font-mono"
                  dir="ltr"
                />
              </div>
              <div className="flex min-w-36 flex-col gap-1.5">
                <Label htmlFor="settings-chunk-size">
                  {t("settings.chunkSize")}
                </Label>
                <Select
                  value={String(current.chunkSize)}
                  onValueChange={(v) => update({ chunkSize: Number(v) })}
                >
                  <SelectTrigger id="settings-chunk-size" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHUNK_SIZES.map((cs) => (
                      <SelectItem key={cs.value} value={String(cs.value)}>
                        <span className="font-mono" dir="ltr">{cs.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Behavior */}
        <SectionCard title={t("settings.behavior")}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="settings-discovery">
                  {t("settings.discovery")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.discoveryHint")}
                </p>
              </div>
              <Switch
                id="settings-discovery"
                checked={current.discoveryEnabled}
                onCheckedChange={(v) => update({ discoveryEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="settings-skip-hidden">
                  {t("settings.skipHidden")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.skipHiddenHint")}
                </p>
              </div>
              <Switch
                id="settings-skip-hidden"
                checked={current.skipHiddenFiles}
                onCheckedChange={(v) => update({ skipHiddenFiles: v })}
              />
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-36 flex-col gap-1.5">
                <Label htmlFor="settings-autosync">
                  {t("settings.autoSync")}
                </Label>
                <Select
                  value={String(current.autoSyncSeconds)}
                  onValueChange={(v) => update({ autoSyncSeconds: Number(v) })}
                >
                  <SelectTrigger id="settings-autosync" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTO_SYNC_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        <span className="font-mono" dir="ltr">
                          {opt.value === 0 ? t("settings.autoSyncOff") : opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("settings.autoSyncHint")}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Interface */}
        <SectionCard title={t("settings.interface")}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>{t("settings.language")}</Label>
              <div
                className="inline-flex items-center rounded-md border p-0.5"
                role="group"
                aria-label={t("settings.language")}
              >
                {(["en", "fa"] as const).map((l) => (
                  <Button
                    key={l}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={lang === l}
                    onClick={() => setLangAndPersist(l)}
                    className={cn(
                      "h-7 rounded-sm px-3 text-xs",
                      lang === l && "bg-primary/10 text-primary hover:bg-primary/15"
                    )}
                  >
                    {l === "en" ? "English" : "فارسی"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>{t("settings.theme")}</Label>
              <div
                className="inline-flex items-center rounded-md border p-0.5"
                role="group"
                aria-label={t("settings.theme")}
              >
                {(["light", "dark", "system"] as const).map((th) => (
                  <Button
                    key={th}
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={theme === th}
                    onClick={() => setThemeAndPersist(th)}
                    className={cn(
                      "h-7 rounded-sm px-3 text-xs",
                      theme === th && "bg-primary/10 text-primary hover:bg-primary/15"
                    )}
                  >
                    {th === "light"
                      ? t("settings.themeLight")
                      : th === "dark"
                        ? t("settings.themeDark")
                        : "System"}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Stored settings (agent response, verbatim) */}
        {stored ? (
          <SectionCard
            title={t("settings.storedResponse")}
            bodyClassName="p-0 sm:p-0"
          >
            <pre
              className="max-h-56 overflow-auto p-4 font-mono text-[11px] leading-5 whitespace-pre-wrap"
              dir="ltr"
            >
              {JSON.stringify(stored, null, 2)}
            </pre>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              {t("settings.storedHint")}
            </p>
          </SectionCard>
        ) : null}

        {/* About */}
        <SectionCard title={t("settings.about")}>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-foreground">
              {t("settings.aboutText")}
            </p>
            <p className="font-mono text-xs text-muted-foreground" dir="ltr">
              version {health.data?.version ?? "—"} · {t("settings.license")} ·{" "}
              {t("settings.copyright")}
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
