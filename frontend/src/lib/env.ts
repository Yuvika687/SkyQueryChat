// Public configuration only. The backend URL is not a secret (the browser calls it directly so the
// backend sees each visitor's own IP for rate limits). Secrets such as DEMO_ACCESS_TOKEN are read only
// in server code (src/app/api/demo/*) and must never get a NEXT_PUBLIC_ prefix.

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");

/** Name of the non-secret cookie that tells the browser to route chat through the demo proxy. */
export const DEMO_FLAG_COOKIE = "sq_demo_on";
