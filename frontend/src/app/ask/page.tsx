import type { Metadata } from "next";
import { AskScreen } from "@/components/ask/ask-screen";

export const metadata: Metadata = { title: "Ask · SkyQueryChat" };

export default function AskPage() {
  return <AskScreen />;
}
