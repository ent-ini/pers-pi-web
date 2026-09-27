import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { MultiusePending } from "@/components/MultiusePending";
import { isMultiuseMode } from "@/lib/runtime-mode";

export const dynamic = "force-dynamic";

export default function Home() {
  if (isMultiuseMode()) return <MultiusePending />;

  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
