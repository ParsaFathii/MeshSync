import type { KeyboardEvent } from "react";

/**
 * Roving-index keyboard navigation for tablist-style switchers.
 * Moves DOM focus among `[data-roving-index]` children, RTL aware.
 */
export function handleRovingKeyDown(
  e: KeyboardEvent<HTMLElement>,
  opts: { vertical?: boolean } = {}
): void {
  const rtl = document.documentElement.dir === "rtl";
  let delta = 0;
  switch (e.key) {
    case "ArrowDown":
      delta = 1;
      break;
    case "ArrowUp":
      delta = -1;
      break;
    case "ArrowRight":
      delta = rtl ? -1 : 1;
      break;
    case "ArrowLeft":
      delta = rtl ? 1 : -1;
      break;
    default:
      return;
  }
  if (opts.vertical && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    return;
  }

  const container = e.currentTarget;
  const buttons = Array.from(
    container.querySelectorAll<HTMLElement>("[data-roving-index]")
  );
  if (buttons.length < 2) return;

  const target = e.target as HTMLElement | null;
  const idxAttr = target
    ?.closest("[data-roving-index]")
    ?.getAttribute("data-roving-index");
  const idx = idxAttr !== null ? Number(idxAttr) : -1;
  if (idx === -1 || Number.isNaN(idx)) return;

  e.preventDefault();
  const next = (idx + delta + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
