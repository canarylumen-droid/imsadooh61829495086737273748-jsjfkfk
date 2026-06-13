import 'dotenv/config';
import { connectMongo, hasMongoUri } from './shared/lib/mongo.js';
import { advancedStorage } from './shared/lib/storage/advanced-storage.js';
import { S3Client, GetBucketLocationCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

async function testMongo() {
  console.log('[Test] Checking MongoDB...');
  if (!hasMongoUri()) {
    console.warn('[Test] ⚠️ MONGODB_URI is not set in env.');
    return;
  }
  try {
    const mongoose = await connectMongo();
    console.log('[Test] ✅ MongoDB Connected Successfully. ReadyState:', mongoose.connection.readyState);
  } catch (err: any) {
    console.error('[Test] ❌ MongoDB Connection Failed:', err.message);
  }
}

async function findBucketRegion() {
  const bucket = process.env.S3_BUCKET_NAME || 'aud-s3-bucket';
  const url = `https://${bucket}.s3.amazonaws.com/`;
  console.log(`[Test] Fetching ${url} to find region...`);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    console.log('[Test] Response status:', res.status);
    console.log('[Test] Response headers:');
    res.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });
  } catch (err: any) {
    console.error('[Test] Fetch failed:', err.message);
  }
}

async function testS3() {
  console.log('[Test] Checking S3 storage...');
  const bucket = process.env.S3_BUCKET_NAME || '';
  const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ap-northeast-2', 'ap-northeast-1', 'eu-west-1', 'ap-southeast-1', 'ap-southeast-2', 'eu-central-1', 'ap-south-1', 'sa-east-1', 'eu-west-2', 'eu-west-3', 'eu-north-1'];
  for (const r of regions) {
    console.log(`[Test] Trying region: ${r}...`);
    const s3 = new S3Client({
      region: r,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      }
    });

    try {
      const dummyKey = `test-region-${r}.txt`;
      const dummyContent = Buffer.from('Audnix S3 Connection Test');
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: dummyKey,
        Body: dummyContent,
        ContentType: 'text/plain',
      }));
      console.log(`[Test] 🎉 SUCCESS IN REGION: ${r}`);
      return;
    } catch (err: any) {
      console.log(`[Test] ❌ Failed in region ${r}:`, err.message);
      // Log headers/metadata to locate bucket region
      if (err.$metadata) {
        console.log(`[Test] Metadata:`, JSON.stringify(err.$metadata));
      }
      if (err.headers) {
        console.log(`[Test] Headers:`, JSON.stringify(err.headers));
      }
    }
  }
}

async function run() {
  await testMongo();
  console.log('-----------------------------------');
  await findBucketRegion();
  console.log('-----------------------------------');
  await testS3();
  process.exit(0);
}

run();
