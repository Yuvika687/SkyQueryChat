import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import { Providers } from "@/components/shell/providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sky-query-chat.vercel.app";
const DESCRIPTION = "The latest available air quality for Delhi, Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad, and an AI analyst that answers questions about it with proof for every number.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "SkyQueryChat · air quality analyst for six Indian cities",
  description: DESCRIPTION,
  applicationName: "SkyQueryChat",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", siteName: "SkyQueryChat", title: "SkyQueryChat · ask India's air anything", description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SkyQueryChat: ask India's air anything" }], locale: "en_IN",
  },
  twitter: { card: "summary_large_image", title: "SkyQueryChat · ask India's air anything", description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#060A14", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`dark ${inter.variable} ${serif.variable} antialiased`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
