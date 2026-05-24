import { z } from 'zod';
import { advancedStorage } from './advanced-storage.js';
import { randomUUID } from 'crypto';

// Schemas
export const CustomObjectionSchema = z.object({
  id: z.string().min(1).default(() => randomUUID()),
  objection: z.string().min(1, "Objection text is required"),
  category: z.enum(['timing', 'price', 'trust', 'authority', 'fit', 'competitor', 'decision', 'general']).default('general'),
  response: z.string().min(1, "Preferred response/handling instruction is required")
});

export type CustomObjection = z.infer<typeof CustomObjectionSchema>;

export const CustomKnowledgeSchema = z.object({
  businessName: z.string().default(''),
  brandVoice: z.string().default(''),
  coreOffer: z.string().default(''),
  customInstructions: z.string().default(''),
  faqs: z.array(z.object({
    question: z.string().min(1, "Question is required"),
    answer: z.string().min(1, "Answer is required")
  })).default([])
});

export type CustomKnowledge = z.infer<typeof CustomKnowledgeSchema>;

// Helper for tenant isolated paths in S3 or local storage fallback
const BUCKET = 'custom-training';

function getS3Path(userId: string, filename: string): string {
  const bucketName = process.env.S3_BUCKET_NAME;
  if (bucketName) {
    return `s3://${bucketName}/${BUCKET}/${userId}/${filename}`;
  }
  // cascading fallback to local/Redis
  return `${BUCKET}/${userId}/${filename}`;
}

export async function getCustomObjections(userId: string): Promise<CustomObjection[]> {
  try {
    const path = getS3Path(userId, 'objections.json');
    const buffer = await advancedStorage.download(path);
    if (!buffer) return [];
    const data = JSON.parse(buffer.toString('utf8'));
    if (!Array.isArray(data)) return [];
    return z.array(CustomObjectionSchema).parse(data);
  } catch (err) {
    console.error(`[CustomTrainingStorage] Failed to download/parse objections for user ${userId}:`, err);
    return [];
  }
}

export async function saveCustomObjections(userId: string, objections: CustomObjection[]): Promise<void> {
  const parsed = z.array(CustomObjectionSchema).parse(objections);
  const buffer = Buffer.from(JSON.stringify(parsed, null, 2), 'utf8');
  const filename = `${userId}/objections.json`;
  await advancedStorage.upload(BUCKET, filename, buffer, 'application/json');
}

export async function getCustomKnowledge(userId: string): Promise<CustomKnowledge> {
  try {
    const path = getS3Path(userId, 'knowledge.json');
    const buffer = await advancedStorage.download(path);
    if (!buffer) {
      return CustomKnowledgeSchema.parse({});
    }
    const data = JSON.parse(buffer.toString('utf8'));
    return CustomKnowledgeSchema.parse(data);
  } catch (err) {
    console.error(`[CustomTrainingStorage] Failed to download/parse knowledge for user ${userId}:`, err);
    return CustomKnowledgeSchema.parse({});
  }
}

export async function saveCustomKnowledge(userId: string, knowledge: CustomKnowledge): Promise<void> {
  const parsed = CustomKnowledgeSchema.parse(knowledge);
  const buffer = Buffer.from(JSON.stringify(parsed, null, 2), 'utf8');
  const filename = `${userId}/knowledge.json`;
  await advancedStorage.upload(BUCKET, filename, buffer, 'application/json');
}
