import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="font-heading text-2xl font-semibold">Page not found</h1>
        <p className="text-muted">The page you are looking for does not exist or is no longer available.</p>
        <Link href="/" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
          Go to home
        </Link>
      </div>
    </main>
  );
}
