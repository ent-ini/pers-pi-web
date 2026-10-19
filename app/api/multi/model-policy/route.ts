import { type NextRequest } from "next/server";
import { PI_WEB_MULTI_SESSION_COOKIE, readMultiuseSessionToken } from "@/lib/multiuse-auth";
import { getMultiuseConfig } from "@/lib/multiuse-config";
import { workerManagerRequest } from "@/lib/worker-manager";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
    try {
        const session = readMultiuseSessionToken(request.cookies.get(PI_WEB_MULTI_SESSION_COOKIE)?.value, getMultiuseConfig());
        if (!session)
            return Response.json({ error: "Authentication required" }, { status: 401 });
        const response = await workerManagerRequest("/model-policy");
        if (!response.ok)
            throw new Error();
        return Response.json(await response.json(), { headers: { "cache-control": "no-store" } });
    }
    catch {
        return Response.json({ error: "Corporate model policy unavailable" }, { status: 503 });
    }
}
