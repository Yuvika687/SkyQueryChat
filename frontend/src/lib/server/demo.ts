import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Owner demo pass. DEMO_ACCESS_TOKEN is a server-only env var (never NEXT_PUBLIC_*): it is compared here
// and forwarded to the backend as X-Demo-Token, but never sent to the browser. The browser only gets an
// httpOnly cookie holding an HMAC of the token, which can't be turned back into the token.

export const DEMO_COOKIE = "sq_demo";

export function demoToken(): string {
  return process.env.DEMO_ACCESS_TOKEN ?? "";
}

export function backendUrl(): string {
  return (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
}

export function cookieValue(): string | null {
  const t = demoToken();
  if (!t) return null;
  return createHmac("sha256", t).update("skyquerychat-demo-v1").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hasDemoCookie(value: string | undefined): boolean {
  const want = cookieValue();
  return Boolean(want && value && safeEqual(value, want));
}
