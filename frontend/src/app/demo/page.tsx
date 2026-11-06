import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Demo access · SkyQueryChat", robots: { index: false } };

// Owner-only page: unlocks the reserved demo quota in this browser. The token is checked on the server.
export default function DemoPage({ searchParams }: PageProps<"/demo">) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <h2 className="text-[24px] leading-8 font-semibold">Demo access</h2>
      <p className="mt-2 text-sm text-subtle">For the project owner during live demos. Visitors don&apos;t need this.</p>
      <form method="post" action="/api/demo/unlock" className="mt-6 flex flex-col gap-3">
        <label htmlFor="token" className="text-sm font-medium">Demo token</label>
        <input
          id="token"
          name="token"
          type="password"
          autoComplete="off"
          required
          className="h-11 rounded-lg border border-line bg-surface px-3 text-sm focus:border-teal focus:outline-none"
        />
        <Suspense fallback={null}>
          <ErrorNote searchParams={searchParams} />
        </Suspense>
        <button type="submit" className="h-11 rounded-lg bg-teal text-sm font-medium text-background hover:bg-teal-hover">Unlock</button>
      </form>
    </div>
  );
}

async function ErrorNote({ searchParams }: { searchParams: PageProps<"/demo">["searchParams"] }) {
  const sp = await searchParams;
  return sp.error ? <p className="text-sm text-danger" role="alert">That token didn&apos;t match.</p> : null;
}
