"use client";

// One wrapper for every data page: skeleton while loading, wake-up message while the free server starts,
// an error with Try again, then the content.
import type { DataState } from "@/lib/use-backend-data";
import { ErrorState, Skeleton, WakeUpState } from "./states";

export function DataGate<T>({ state, what, skeleton, children }: {
  state: DataState<T>;
  what: string;
  skeleton?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (state.kind === "ready") return <>{children(state.data)}</>;
  if (state.kind === "error") {
    return <ErrorState title={`The ${what} could not load`} message="The data server did not answer. Please try again in a moment." onRetry={state.retry} />;
  }
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {state.kind === "waking" && <WakeUpState />}
      {skeleton ?? <PageSkeleton />}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3" aria-hidden>
      <Skeleton className="h-44 md:col-span-2" />
      <Skeleton className="h-44" />
      <Skeleton className="h-72 md:col-span-3" />
    </div>
  );
}
