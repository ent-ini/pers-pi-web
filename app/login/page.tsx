import { MultiuseLogin } from "@/components/MultiuseLogin";
import { WebPasswordLogin } from "@/components/WebPasswordLogin";
import { isMultiuseMode } from "@/lib/runtime-mode";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return isMultiuseMode() ? <MultiuseLogin /> : <WebPasswordLogin />;
}
