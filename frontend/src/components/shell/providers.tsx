"use client";

import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "./app-context";
import { AppShell } from "./app-shell";

/** Client providers. Motion follows the visitor's "reduce motion" setting everywhere. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delay={300}>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
