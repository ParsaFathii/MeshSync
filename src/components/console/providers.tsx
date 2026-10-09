"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { I18nProvider, useI18n } from "@/lib/i18n";

/** Toast placement follows the active direction. */
function DirectionAwareToaster() {
  const { lang } = useI18n();
  return (
    <Toaster
      position={lang === "fa" ? "bottom-left" : "bottom-right"}
      closeButton
      dir={lang === "fa" ? "rtl" : "ltr"}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2_000,
            refetchOnWindowFocus: true,
            retry: false,
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {children}
        <DirectionAwareToaster />
      </I18nProvider>
    </QueryClientProvider>
  );
}
