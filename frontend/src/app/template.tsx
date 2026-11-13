// A new instance on every navigation: a short fade between pages (CSS, opacity only so fixed layouts such as
// Explore are unaffected; none with reduced motion).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="sq-page">{children}</div>;
}
