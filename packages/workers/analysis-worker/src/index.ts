import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { analyzeProject } from '@ai-code-debt/core';
import * as path from 'path';

// Usually provided by env vars
const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
});

const worker = new Worker(
  'AnalysisQueue',
  async (job: Job) => {
    console.log(`[Worker] Started processing job ${job.id}`);
    const { entryPoints = [], excludePatterns = [], enableAiVerification = false } = job.data;
    
    // Resolve absolute paths
    const workspaceRoot = path.resolve(__dirname, '../../../../');
    const absoluteEntryPoints = entryPoints.map((ep: string) => path.join(workspaceRoot, ep));
    
    const report = await analyzeProject({
      entryPoints: absoluteEntryPoints,
      excludePatterns,
      enableAiVerification,
    });
    
    console.log(`[Worker] Finished job ${job.id}. Found ${report.totalFindings} dead code items.`);
    return report;
  },
  { connection }
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error:`, err);
});

console.log('[Worker] Analysis worker started. Waiting for jobs...');
