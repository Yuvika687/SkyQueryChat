import { cookies } from "next/headers";
import { backendUrl, DEMO_COOKIE, demoToken, hasDemoCookie } from "@/lib/server/demo";

// Same-origin proxy used only in owner demo mode: adds X-Demo-Token on the server and streams the
// backend's Server-Sent Events back unchanged.
export async function POST(request: Request) {
  const jar = await cookies();
  if (!demoToken() || !hasDemoCookie(jar.get(DEMO_COOKIE)?.value)) {
    return Response.json({ error: { code: "forbidden", message: "Demo mode is not unlocked." } }, { status: 403 });
  }
  const body = await request.text();
  if (body.length > 2000) {
    return Response.json({ error: { code: "invalid_input", message: "Question is too long." } }, { status: 422 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Demo-Token": demoToken() },
      body,
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: { code: "network", message: "The analysis service could not be reached." } }, { status: 502 });
  }
  const headers = new Headers({ "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-cache" });
  const retry = upstream.headers.get("Retry-After");
  if (retry) headers.set("Retry-After", retry);
  return new Response(upstream.body, { status: upstream.status, headers });
}
