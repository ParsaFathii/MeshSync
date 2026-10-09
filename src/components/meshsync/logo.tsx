import { cn } from "@/lib/utils";

/**
 * Original MeshSync mark: three rounded-square nodes (top-center emerald,
 * bottom-left / bottom-right stone) linked by lines forming a mesh triangle.
 * The wordmark stays latin even in Persian mode.
 */

export function MeshSyncLogo({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("text-stone-400 dark:text-stone-500 shrink-0", className)}
    >
      <path
        d="M16 9.4 L7.9 22.2 M16 9.4 L24.1 22.2 M7.9 22.2 L24.1 22.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <rect x="12.2" y="5.4" width="7.6" height="7.6" rx="2.1" fill="var(--primary)" />
      <rect
        x="3.9"
        y="18.6"
        width="7.6"
        height="7.6"
        rx="2.1"
        fill="currentColor"
        className="text-stone-500 dark:text-stone-400"
      />
      <rect
        x="20.5"
        y="18.6"
        width="7.6"
        height="7.6"
        rx="2.1"
        fill="currentColor"
        className="text-stone-500 dark:text-stone-400"
      />
    </svg>
  );
}

export function MeshSyncWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-semibold tracking-tight text-foreground select-none",
        className
      )}
      style={{ fontFamily: '"Inter", system-ui, sans-serif' }}
    >
      MeshSync
    </span>
  );
}

export function MeshSyncLogoLockup({
  size = 26,
  className,
  wordmarkClassName,
}: {
  size?: number;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <MeshSyncLogo size={size} />
      <MeshSyncWordmark className={wordmarkClassName} />
    </span>
  );
}
