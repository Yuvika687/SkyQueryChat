import { Suspense } from "react";
import type { Metadata } from "next";
import { AskPage } from "@/components/ask/ask-page";

export const metadata: Metadata = {
  title: "Ask the analyst · SkyQueryChat",
  description: "Ask any question about air quality in Delhi, Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad. Python calculates every number and each one links to its proof.",
  alternates: { canonical: "/ask" },
};

export default function Page() {
  // The address may carry a question (/ask?q=...), which is request data, so it is read inside Suspense.
  return (
    <Suspense fallback={null}>
      <AskPage />
    </Suspense>
  );
}
