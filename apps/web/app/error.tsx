"use client"

import Link from "next/link"

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="text-center max-w-sm">
        <p className="text-7xl font-extrabold text-indigo-600 tracking-tight leading-none">500</p>
        <h1 className="mt-4 text-2xl font-bold text-zinc-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-500">
          An unexpected error occurred. Try refreshing the page — if it keeps happening, contact support.
        </p>
        {error.digest && (
          <p className="mt-1 text-xs text-zinc-400 font-mono">Error ID: {error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-zinc-200 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
