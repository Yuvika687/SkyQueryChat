import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CityScreen } from "@/components/city/city-screen";
import { CITY_SLUGS, cityName } from "@/lib/pages-api";

const known = (slug: string) => (CITY_SLUGS as readonly string[]).includes(slug);

export function generateStaticParams() {
  return CITY_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!known(slug)) return { title: "Page not found · SkyQueryChat" };
  const city = cityName(slug);
  return {
    title: `${city} air quality · SkyQueryChat`,
    description: `${city}'s air from real monitoring data: latest PM2.5, the last 30 days, a daily calendar, Diwali AQI, unusual days, weather associations and every station.`,
    alternates: { canonical: `/city/${slug}` },
  };
}

async function City({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!known(slug)) notFound();          // only the six cities exist
  return <CityScreen slug={slug} city={cityName(slug)} />;
}

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <City params={params} />
    </Suspense>
  );
}
