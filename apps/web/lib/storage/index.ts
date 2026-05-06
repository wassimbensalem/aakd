import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const s3 = new S3Client({
  region: process.env.STORAGE_REGION ?? "us-east-1",
  endpoint: process.env.STORAGE_ENDPOINT || undefined,
  forcePathStyle: !!process.env.STORAGE_ENDPOINT, // required for MinIO
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "",
  },
})

const BUCKET = process.env.STORAGE_BUCKET ?? "clauseflow"

export const storage = {
  async upload(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }))
    return key
  },

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn })
  },

  async delete(key: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  },

  storageKey(organizationId: string, contractId: string, filename: string): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    return `orgs/${organizationId}/contracts/${contractId}/${Date.now()}_${sanitized}`
  },
}
