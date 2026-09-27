import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";

export const dynamic = "force-dynamic";

export default function Home() {
  // In multi mode the same UI is backed by the authenticated employee's
  // worker: proxy.ts rewrites legacy API calls before they reach this process.
  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
