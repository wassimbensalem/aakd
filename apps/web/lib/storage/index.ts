import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

let _s3: S3Client | null = null

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.STORAGE_REGION ?? "us-east-1",
      endpoint: process.env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: !!process.env.STORAGE_ENDPOINT, // required for MinIO
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "",
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "",
      },
    })
  }
  return _s3
}

function getBucket(): string {
  return process.env.STORAGE_BUCKET ?? "aakd"
}

export const storage = {
  async upload(key: string, body: Buffer | Uint8Array, contentType: string): Promise<string> {
    await getS3().send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: body, ContentType: contentType }))
    return key
  },

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), { expiresIn })
  },

  async delete(key: string): Promise<void> {
    await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }))
  },

  storageKey(organizationId: string, contractId: string, filename: string): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    return `orgs/${organizationId}/contracts/${contractId}/${Date.now()}_${sanitized}`
  },
}
