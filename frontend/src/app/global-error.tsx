"use client";

// Last resort when the root layout itself fails: plain markup with inline styles (the app's CSS may not load).
export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ margin: 0, minHeight: "100vh", background: "#060A14", color: "#E6EAF5", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center" }}>
        <main style={{ maxWidth: 520, padding: 24 }}>
          <h1 style={{ fontSize: 32, margin: "0 0 12px" }}>SkyQueryChat hit a problem</h1>
          <p style={{ color: "#94A0BC", margin: "0 0 24px" }}>Please try again in a moment.</p>
          <button onClick={() => retry()} style={{ background: "#2DD4BF", color: "#04201C", border: 0, borderRadius: 12, padding: "12px 18px", fontWeight: 600, cursor: "pointer" }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
