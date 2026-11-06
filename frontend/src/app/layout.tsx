import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/components/shell/app-context";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SkyQueryChat",
  description: "Ask about PM2.5 and PM10 in six Indian cities. Every answer shows its data type, period, stations, coverage and source.",
};

export const viewport: Viewport = { themeColor: "#0B1020", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`dark ${inter.variable} ${mono.variable} antialiased`}>
      <body>
        <TooltipProvider delay={300}>
          <AppProvider>
            <AppShell>{children}</AppShell>
          </AppProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
