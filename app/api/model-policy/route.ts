import { personalModelsAllowed } from "@/lib/corporate-model-policy";
export const dynamic = "force-dynamic";
export async function GET() {
    try {
        return Response.json({ allowPersonalModels: personalModelsAllowed() }, { headers: { "cache-control": "no-store" } });
    }
    catch {
        return Response.json({ error: "Corporate model policy unavailable" }, { status: 503 });
    }
}
