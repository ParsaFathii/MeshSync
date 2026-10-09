import { EnumBadge, type BadgeTone } from "./enum-badge";

import type { TrustLevel } from "@/lib/types";

/** DISCOVERED / PAIRING / TRUSTED / REVOKED — latin mono badge. */
export function TrustBadge({ trust }: { trust: TrustLevel }) {
  const tone: BadgeTone =
    trust === "TRUSTED"
      ? "emerald"
      : trust === "PAIRING"
        ? "amber"
        : trust === "REVOKED"
          ? "red"
          : "stone";
  return <EnumBadge value={trust} tone={tone} />;
}
