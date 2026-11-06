import { cookies } from "next/headers";
import { DEMO_FLAG_COOKIE } from "@/lib/env";
import { cookieValue, DEMO_COOKIE, demoToken, safeEqual } from "@/lib/server/demo";

const WEEK = 7 * 24 * 3600;

// POST (form field "token"): unlock demo mode in this browser. DELETE: lock it again.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const given = String(form?.get("token") ?? "");
  const want = demoToken();
  await new Promise((r) => setTimeout(r, 400)); // slow down guessing
  const base = new URL(request.url);
  if (!want || !given || !safeEqual(given, want)) {
    return Response.redirect(new URL("/demo?error=1", base), 303);
  }
  const jar = await cookies();
  const secure = base.protocol === "https:";
  jar.set(DEMO_COOKIE, cookieValue()!, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: WEEK });
  jar.set(DEMO_FLAG_COOKIE, "1", { httpOnly: false, secure, sameSite: "strict", path: "/", maxAge: WEEK });
  return Response.redirect(new URL("/ask", base), 303);
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(DEMO_COOKIE);
  jar.delete(DEMO_FLAG_COOKIE);
  return new Response(null, { status: 204 });
}
