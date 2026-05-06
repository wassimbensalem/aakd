"use client"

import { formatDistanceToNow } from "date-fns"

export function RelativeTime({ date }: { date: string | Date }) {
  return (
    <time
      dateTime={new Date(date).toISOString()}
      title={new Date(date).toLocaleString()}
    >
      {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </time>
  )
}
