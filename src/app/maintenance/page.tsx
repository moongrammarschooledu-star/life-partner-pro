export const metadata = { title: "Maintenance — Life Partner Pro" };

// Neutral page shown by proxy.ts while maintenance / emergency mode is active
// (spec §27/§57). Static on purpose: it must render even if the database is
// the thing being worked on. No technical details are ever shown here.
export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="font-heading text-2xl font-semibold">Life Partner Pro</h1>
        <p className="text-muted">Life Partner Pro is temporarily undergoing maintenance. Please try again later.</p>
      </div>
    </main>
  );
}
