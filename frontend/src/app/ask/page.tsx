import { Suspense } from "react";
import type { Metadata } from "next";
import { AskPage } from "@/components/ask/ask-page";

export const metadata: Metadata = { title: "Ask · SkyQueryChat" };

export default function Page() {
  // The address may carry a question (/ask?q=...), which is request data, so it is read inside Suspense.
  return (
    <Suspense fallback={null}>
      <AskPage />
    </Suspense>
  );
}
