"use client"

import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { ContractType } from "@/lib/types"

export function ContractTypeBadge({ type }: { type: ContractType | null | undefined }) {
  const t = useTranslations("contract.types")
  if (!type) return null
  return (
    <Badge variant="outline" className="font-normal">
      {t(type)}
    </Badge>
  )
}
