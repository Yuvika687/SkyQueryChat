import { Suspense } from "react";
import type { Metadata } from "next";
import { ExploreScreen } from "@/components/explore/explore-screen";

export const metadata: Metadata = {
  title: "Explore the map · SkyQueryChat",
  description: "Every air quality monitoring station in six Indian cities on a map, with 24-hour PM2.5 and PM10 for the latest 30 available days.",
  alternates: { canonical: "/explore" },
};

export default function Page() {
  // The view is read from the address (?city=&station=&pollutant=&date=), so it sits inside Suspense.
  return (
    <Suspense fallback={null}>
      <ExploreScreen />
    </Suspense>
  );
}
