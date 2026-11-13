import { Suspense } from "react";
import type { Metadata } from "next";
import { ComingPage } from "@/components/pages/coming-page";

export const metadata: Metadata = { title: "Compare · SkyQueryChat" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ComingPage title="Compare" purpose="Put two to six cities side by side over any period." />
    </Suspense>
  );
}
