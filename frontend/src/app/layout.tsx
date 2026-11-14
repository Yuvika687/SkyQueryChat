import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import { Providers } from "@/components/shell/providers";
import { API_BASE_URL } from "@/lib/env";
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

// Early wake-up ping: Render's free backend sleeps after 15 idle minutes and takes 30-60 s to wake. This tiny inline
// script runs while the HTML is still being read, before the app's JavaScript loads, so the backend starts waking at
// once. The response is not read (no-cors); the app's own health check follows as usual.
const WAKE_PING = `try{fetch(${JSON.stringify(`${API_BASE_URL}/api/health`)},{mode:"no-cors",cache:"no-store",keepalive:true}).catch(function(){})}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`dark ${inter.variable} ${serif.variable} antialiased`}>
      <head>
        <link rel="preconnect" href={API_BASE_URL} crossOrigin="anonymous" />
        <script id="wake-ping" dangerouslySetInnerHTML={{ __html: WAKE_PING }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
