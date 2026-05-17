import { ClauseFlowLogo } from "@/components/aakd-logo"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <ClauseFlowLogo size={38} wordmarkClassName="text-xl text-zinc-900" />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  )
}
