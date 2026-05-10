// Re-export from M5 notification crypto — same NOTIFICATION_ENCRYPTION_KEY (AES-256-GCM).
// M5 exports `encrypt`/`decrypt`; we alias them as `encryptToken`/`decryptToken`
// for clarity at CRM call sites.
export { encrypt as encryptToken, decrypt as decryptToken } from "@/lib/notifications/crypto"
