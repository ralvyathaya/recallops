import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

function bucket() {
  if (!process.env.EVIDENCE_BUCKET) throw new Error("EVIDENCE_BUCKET is not configured");
  return process.env.EVIDENCE_BUCKET;
}

export async function putArtifact(key: string, body: string, contentType = "application/json") {
  await client.send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
  }));
  return key;
}

export async function getArtifact(key: string) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!result.Body) throw new Error(`Artifact ${key} is empty`);
  return result.Body.transformToString();
}
