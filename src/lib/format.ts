/**
 * Formatting helpers.
 *
 * Two "voices":
 *  - UI voice  (dates, relative times): locale aware (fa-IR for Persian,
 *    Persian digits where Intl produces them).
 *  - Data voice (hashes, sizes, speeds, durations, ports, versions): always
 *    latin digits, rendered in JetBrains Mono by the components.
 */

export type Lang = "en" | "fa";

const DATA_NUM = new Intl.NumberFormat("en-US");
const DATA_NUM_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const rtCache = new Map<string, Intl.RelativeTimeFormat>();
const dtCache = new Map<string, Intl.DateTimeFormat>();

function localeOf(lang: Lang): string {
  return lang === "fa" ? "fa-IR" : "en-GB";
}

function relFmt(lang: Lang): Intl.RelativeTimeFormat {
  const key = localeOf(lang);
  let f = rtCache.get(key);
  if (!f) {
    f = new Intl.RelativeTimeFormat(key, { numeric: "auto" });
    rtCache.set(key, f);
  }
  return f;
}

function dtFmt(lang: Lang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${localeOf(lang)}:${JSON.stringify(opts)}`;
  let f = dtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(localeOf(lang), opts);
    dtCache.set(key, f);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Data voice (latin digits, mono rendering)
// ---------------------------------------------------------------------------

/** Byte count → compact binary string, e.g. "1.4 MiB". */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n < 1024) return `${DATA_NUM.format(n)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = n;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? DATA_NUM.format(Math.round(value)) : DATA_NUM.format(Math.round(value * 10) / 10)} ${units[unit]}`;
}

/** Bytes per second → "512 KiB/s". */
export function formatSpeed(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n) || n <= 0) return "0 B/s";
  return `${formatBytes(n)}/s`;
}

/** Compact latin number (file counts etc.). */
export function formatNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return DATA_NUM.format(n);
}

export function formatCompactNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return DATA_NUM_COMPACT.format(n);
}

/** Duration in seconds → compact latin, e.g. "2h 14m", "45s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0)
    return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 === 0 ? `${m}m` : `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

/** Live uptime style: "2h 14m 09s". */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0)
    return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

// ---------------------------------------------------------------------------
// UI voice (locale aware)
// ---------------------------------------------------------------------------

function parseTs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** "5 minutes ago" / "۵ دقیقه پیش". */
export function formatRelative(
  iso: string | null | undefined,
  lang: Lang,
  now = Date.now()
): string {
  const t = parseTs(iso);
  if (t === null) return "—";
  const diffSec = Math.round((t - now) / 1000);
  const rtf = relFmt(lang);
  const abs = Math.abs(diffSec);
  if (abs < 45) return rtf.format(Math.round(diffSec), "second");
  if (abs < 2700) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 79200) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2_592_000) return rtf.format(Math.round(diffSec / 86400), "day");
  return rtf.format(Math.round(diffSec / 2_592_000), "month");
}

/** Short date + time, e.g. "8 Oct 2026, 10:02". */
export function formatDateTime(iso: string | null | undefined, lang: Lang): string {
  const t = parseTs(iso);
  if (t === null) return "—";
  return dtFmt(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);
}

/** ISO date only, e.g. "2026-10-08". */
export function formatDateIso(iso: string | null | undefined): string {
  const t = parseTs(iso);
  if (t === null) return "—";
  const d = new Date(t);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Truncates a hash string: first 8 … last 6. */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}
