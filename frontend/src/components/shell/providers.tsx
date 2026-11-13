"use client";

import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/ds/toast";
import { AppProvider } from "./app-context";
import { QuickAskProvider } from "./quick-ask";
import { AppShell } from "./app-shell";

/** Client providers. Motion follows the visitor's "reduce motion" setting everywhere. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delay={300}>
        <AppProvider>
          <ToastProvider>
            <QuickAskProvider>
              <AppShell>{children}</AppShell>
            </QuickAskProvider>
          </ToastProvider>
        </AppProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
