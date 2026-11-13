import { Suspense } from "react";
import type { Metadata } from "next";
import { CompareScreen } from "@/components/compare/compare-screen";

export const metadata: Metadata = {
  title: "Compare cities · SkyQueryChat",
  description: "Put Delhi, Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad side by side over the same dates: daily lines, a ranking with 95% ranges, trends and coverage.",
  alternates: { canonical: "/compare" },
};

export default function Page() {
  // The selection is read from the address (?cities=&metric=&period= or &start=&end=), so it sits inside Suspense.
  return (
    <Suspense fallback={null}>
      <CompareScreen />
    </Suspense>
  );
}
