import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="text-center max-w-sm">
        <p className="text-7xl font-extrabold text-indigo-600 tracking-tight leading-none">404</p>
        <h1 className="mt-4 text-2xl font-bold text-zinc-900">Page not found</h1>
        <p className="mt-2 text-sm text-zinc-500">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center justify-center h-9 px-4 rounded-md bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
