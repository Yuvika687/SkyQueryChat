import { Suspense } from "react";
import type { Metadata } from "next";
import { ComingPage } from "@/components/pages/coming-page";

export const metadata: Metadata = { title: "Explore · SkyQueryChat" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ComingPage title="Explore" purpose="Look closer at the monitoring stations in each city." />
    </Suspense>
  );
}
