import { redirect } from "next/navigation";

// Explore will become the landing page once it is built; until then the app opens on Ask.
export default function Home() {
  redirect("/ask");
}
