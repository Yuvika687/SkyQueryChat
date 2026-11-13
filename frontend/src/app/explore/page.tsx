import { Suspense } from "react";
import type { Metadata } from "next";
import { ExploreScreen } from "@/components/explore/explore-screen";

export const metadata: Metadata = { title: "Explore · SkyQueryChat" };

export default function Page() {
  // The view is read from the address (?city=&station=&pollutant=&date=), so it sits inside Suspense.
  return (
    <Suspense fallback={null}>
      <ExploreScreen />
    </Suspense>
  );
}
