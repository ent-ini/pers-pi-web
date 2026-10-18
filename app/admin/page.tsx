import { MultiuseAdmin } from "@/components/MultiuseAdmin";
import { I18nProvider } from "@/hooks/useI18n";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <I18nProvider initialLocale="ru"><MultiuseAdmin /></I18nProvider>;
}
