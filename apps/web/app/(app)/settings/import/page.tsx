"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { CsvImportTab } from "@/components/import/csv-import-tab"
import { BatchImportTab } from "@/components/import/batch-import-tab"
import { GoogleDriveTab } from "@/components/import/gdrive-tab"
import { PandaDocTab } from "@/components/import/pandadoc-tab"
import { ClmExportTab } from "@/components/import/clm-export-tab"
import { ImportHistory } from "@/components/import/import-history"

const VALID_TABS = new Set(["csv", "batch", "gdrive", "pandadoc", "clm"])

function ImportPageBody() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get("tab")
  const defaultTab = initialTab && VALID_TABS.has(initialTab) ? initialTab : "csv"

  const [historyKey, setHistoryKey] = useState(0)
  const refreshHistory = () => setHistoryKey((k) => k + 1)

  useEffect(() => {
    if (searchParams.get("connected") === "true") {
      toast.success("Google Drive connected")
    }
    const err = searchParams.get("error")
    if (err) {
      toast.error(`Google Drive connection failed: ${err}`)
    }
  }, [searchParams])

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Import contracts</h1>
        <p className="text-sm text-muted-foreground">
          Migrate your existing contracts into ClauseFlow from spreadsheets, PandaDoc, ContractBook, DocuSign CLM, or any tool that can export files.
        </p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="csv">Spreadsheet (CSV)</TabsTrigger>
          <TabsTrigger value="batch">Batch Files</TabsTrigger>
          <TabsTrigger value="gdrive">Google Drive</TabsTrigger>
          <TabsTrigger value="pandadoc">PandaDoc</TabsTrigger>
          <TabsTrigger value="clm">CLM Export</TabsTrigger>
        </TabsList>

        <TabsContent value="csv" className="mt-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6">
            <CsvImportTab onJobCreated={refreshHistory} />
          </div>
        </TabsContent>

        <TabsContent value="batch" className="mt-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6">
            <BatchImportTab onJobCreated={refreshHistory} />
          </div>
        </TabsContent>

        <TabsContent value="gdrive" className="mt-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6">
            <GoogleDriveTab onJobCreated={refreshHistory} />
          </div>
        </TabsContent>

        <TabsContent value="pandadoc" className="mt-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6">
            <PandaDocTab onJobCreated={refreshHistory} />
          </div>
        </TabsContent>

        <TabsContent value="clm" className="mt-4">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6">
            <ClmExportTab onJobCreated={refreshHistory} />
          </div>
        </TabsContent>
      </Tabs>

      <ImportHistory refreshKey={historyKey} />
    </div>
  )
}

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <ImportPageBody />
    </Suspense>
  )
}
