/**
 * The gateway's object storage: an S3-compatible bucket (SeaweedFS locally, a Railway bucket on
 * staging), from S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and
 * S3_FORCE_PATH_STYLE. Unset S3_BUCKET: there is no bucket and `storage()` is null.
 *
 * The bucket stays private. The page sees objects only through the gateway (GET /api/cutouts/...).
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export function storageSettings(env = process.env) {
  return {
    bucket: (env.S3_BUCKET ?? "").trim(),
    endpoint: (env.S3_ENDPOINT ?? "").trim() || undefined,
    region: (env.S3_REGION ?? "").trim() || "us-east-1",
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true").trim() !== "false",
    accessKeyId: (env.S3_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (env.S3_SECRET_ACCESS_KEY ?? "").trim(),
  };
}

/** A small wrapper over one bucket: put, get (a stream), and whether a key exists. */
export function createStorage(settings = storageSettings()) {
  if (!settings.bucket) return null;
  const client = new S3Client({
    region: settings.region,
    endpoint: settings.endpoint,
    forcePathStyle: settings.forcePathStyle,
    ...(settings.accessKeyId ? { credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } } : {}),
    requestHandler: { requestTimeout: 30_000, connectionTimeout: 5_000 },
  });
  const Bucket = settings.bucket;
  return {
    bucket: Bucket,
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
    },
    /** { body: a readable stream, contentType, length }, or null when the key doesn't exist. */
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return { body: out.Body, contentType: out.ContentType ?? "application/octet-stream", length: out.ContentLength };
      } catch (e) {
        if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
    async getBytes(key) {
      const out = await this.get(key);
      return out ? Buffer.from(await out.body.transformToByteArray()) : null;
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (e) {
        if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) return false;
        throw e;
      }
    },
  };
}

let shared;
/** The shared bucket, or null when S3_BUCKET isn't set. */
export function storage() {
  if (shared === undefined) shared = createStorage();
  return shared;
}
