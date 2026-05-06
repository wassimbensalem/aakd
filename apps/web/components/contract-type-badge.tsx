import { Badge } from "@/components/ui/badge"
import { ContractType } from "@/lib/types"

const typeLabels: Record<ContractType, string> = {
  NDA: "NDA",
  MSA: "MSA",
  SOW: "SOW",
  EMPLOYMENT: "Employment",
  VENDOR: "Vendor",
  CUSTOMER: "Customer",
  OTHER: "Other",
}

export function ContractTypeBadge({ type }: { type: ContractType }) {
  return (
    <Badge variant="outline" className="font-normal">
      {typeLabels[type] ?? type}
    </Badge>
  )
}
