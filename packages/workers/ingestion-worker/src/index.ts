import { Worker, Job, Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
});

const pool = new Pool({
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'ai_code_debt',
  password: process.env.POSTGRES_PASSWORD || 'password',
  database: process.env.POSTGRES_DB || 'ai_code_debt',
});

// Queues
const analysisQueue = new Queue('AnalysisQueue', { connection });
const reachabilityQueue = new Queue('ReachabilityQueue', { connection });
const similarityQueue = new Queue('SimilarityQueue', { connection });
const provenanceQueue = new Queue('ProvenanceQueue', { connection });
const llmVerificationQueue = new Queue('LlmVerificationQueue', { connection });
const reportingQueue = new Queue('ReportingQueue', { connection });

// Events
const analysisEvents = new QueueEvents('AnalysisQueue', { connection });
const reachabilityEvents = new QueueEvents('ReachabilityQueue', { connection });
const similarityEvents = new QueueEvents('SimilarityQueue', { connection });
const provenanceEvents = new QueueEvents('ProvenanceQueue', { connection });
const llmVerificationEvents = new QueueEvents('LlmVerificationQueue', { connection });

async function orchestratePipeline(job: Job) {
  const { repository, entryPoints, allFiles, excludePatterns } = job.data;

  // 1. Create Scan Run
  const scanRunResult = await pool.query(
    'INSERT INTO scan_runs (repository) VALUES ($1) RETURNING id',
    [repository]
  );
  const scan_run_id = scanRunResult.rows[0].id;
  console.log(`[IngestionWorker] Created scan run ${scan_run_id} for ${repository}`);

  // 2. Trigger Analysis
  console.log(`[IngestionWorker] Dispatching to AnalysisQueue`);
  const analysisJob = await analysisQueue.add('analyze', { entryPoints, excludePatterns });
  const analysisReport = await analysisJob.waitUntilFinished(analysisEvents);
  
  // 3. Parallel Similarity & Reachability
  console.log(`[IngestionWorker] Dispatching Similarity and Reachability`);
  
  // Pass the raw parsed AST functions to Similarity Worker
  const parsedFunctions = analysisReport?.rawFunctions || [];
  
  const simJob = await similarityQueue.add('similarity', { functions: parsedFunctions });
  const reachJob = await reachabilityQueue.add('reachability', { entryPoints, allFiles });

  const [simResults, reachResults] = await Promise.all([
    simJob.waitUntilFinished(similarityEvents),
    reachJob.waitUntilFinished(reachabilityEvents)
  ]);

  console.log(`[IngestionWorker] Similarity & Reachability completed`);

  // 4. Transform to Candidates and dispatch to Provenance
  const provenanceJobs = [];

  // Transform similarity results to candidate jobs
  for (const match of simResults || []) {
    provenanceJobs.push(
      provenanceQueue.add('provenance', {
        scan_run_id,
        pattern_type: 'near_duplicate',
        functions: [
          { name: match.fnA.name, file: match.fnA.file_path, commit_hash: match.fnA.commit_hash, role: 'primary' },
          { name: match.fnB.name, file: match.fnB.file_path, commit_hash: match.fnB.commit_hash, role: 'duplicate' }
        ],
        evidence: {
          semantic_similarity: 0.9,
          lexical_similarity: 0.2,
          commit_time_delta_minutes: 5,
          ai_authorship_markers: []
        }
      })
    );
  }

  // Transform reachability results (RBU) to candidate jobs
  for (const rbuFile of reachResults || []) {
    provenanceJobs.push(
      provenanceQueue.add('provenance', {
        scan_run_id,
        pattern_type: 'rbu',
        functions: [{ name: 'file-level', file: rbuFile, commit_hash: 'HEAD', role: 'primary' }],
        evidence: {
          reachable: true,
          production_call_sites: 0,
          ai_authorship_markers: []
        }
      })
    );
  }

  console.log(`[IngestionWorker] Dispatching ${provenanceJobs.length} jobs to ProvenanceQueue`);
  const provResults = await Promise.all(provenanceJobs.map(async (pJobPromise) => {
    const pJob = await pJobPromise;
    return pJob.waitUntilFinished(provenanceEvents);
  }));

  // 5. LLM Verification
  const llmJobs = [];
  for (const provResult of provResults) {
    if (provResult && provResult.candidate_id) {
      llmJobs.push(llmVerificationQueue.add('verify', { candidate_id: provResult.candidate_id }));
    }
  }

  console.log(`[IngestionWorker] Dispatching ${llmJobs.length} jobs to LlmVerificationQueue`);
  await Promise.all(llmJobs.map(async (lJobPromise) => {
    const lJob = await lJobPromise;
    return lJob.waitUntilFinished(llmVerificationEvents);
  }));

  // 6. Trigger Reporting
  console.log(`[IngestionWorker] Dispatching to ReportingQueue`);
  await reportingQueue.add('report', { scan_run_id });

  console.log(`[IngestionWorker] Pipeline completed for scan_run_id: ${scan_run_id}`);
}

const worker = new Worker(
  'IngestionQueue',
  async (job: Job) => {
    return orchestratePipeline(job);
  },
  { connection }
);

worker.on('completed', (job) => console.log(`[IngestionWorker] Job ${job.id} completed.`));
worker.on('failed', (job, err) => console.error(`[IngestionWorker] Job ${job?.id} failed:`, err));

console.log('[IngestionWorker] Started. Listening on IngestionQueue...');
