import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { createGitHubCheck } from '@ai-code-debt/github-app';

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

async function processReporting(job: Job) {
  const { scan_run_id } = job.data;

  // 1. Fetch scan run details
  const scanRun = await pool.query(`SELECT * FROM scan_runs WHERE id = $1`, [scan_run_id]);
  if (scanRun.rows.length === 0) {
    throw new Error('Repository / Scan Run not found');
  }
  const repo = scanRun.rows[0];

  // 2. Fetch candidates
  const query = `
    SELECT c.*, 
           json_agg(json_build_object('name', cf.name, 'file', cf.file, 'commit', cf.commit_hash)) as functions,
           row_to_json(ce.*) as evidence
    FROM candidates c
    LEFT JOIN candidate_functions cf ON c.id = cf.candidate_id
    LEFT JOIN candidate_evidence ce ON c.id = ce.candidate_id
    WHERE c.scan_run_id = $1
    GROUP BY c.id, ce.candidate_id
  `;
  const result = await pool.query(query, [scan_run_id]);
  
  const candidates = result.rows.map(row => {
    if (row.evidence) delete row.evidence.candidate_id;
    return {
      candidate_id: row.id,
      pattern_type: row.pattern_type,
      confidence: row.confidence,
      functions: row.functions,
      evidence: row.evidence,
      suggested_action: row.suggested_action,
      definition: row.definition,
      llm_verification: row.llm_verification
    };
  });

  let high = 0;
  let unclear = 0;
  candidates.forEach(c => {
    if (c.confidence === 'high') high++;
    else if (c.confidence === 'provenance_unclear') unclear++;
  });

  const report = {
    repository: repo.repository,
    generated_at: repo.generated_at,
    summary: {
      total_candidates: candidates.length,
      high_confidence: high,
      provenance_unclear: unclear
    },
    candidates
  };

  console.log(`[ReportingWorker] Generated report for ${repo.repository} with ${candidates.length} candidates.`);

  // 3. Optional: Publish to GitHub if octokit config exists
  // In a full production setup, the ingestion webhook would pass owner/repo/sha
  // Here we assume repo string is "owner/repo" and we mock the check creation for demonstration
  try {
    const [owner, repoName] = repo.repository.split('/');
    if (owner && repoName) {
      // Mock octokit
      const mockOctokit = {
        rest: {
          checks: {
            create: async (params: any) => {
              console.log(`[ReportingWorker] Created GitHub Check for ${owner}/${repoName}: ${params.conclusion}`);
            }
          }
        }
      };
      
      await createGitHubCheck(mockOctokit, owner, repoName, 'HEAD', report as any);
    }
  } catch (err) {
    console.error('[ReportingWorker] Failed to create GitHub check:', err);
  }

  return report;
}

const worker = new Worker(
  'ReportingQueue',
  async (job: Job) => {
    console.log(`[ReportingWorker] Processing report for scan ${job.data.scan_run_id}`);
    return processReporting(job);
  },
  { connection }
);

worker.on('completed', (job) => console.log(`[ReportingWorker] Job ${job.id} completed.`));
worker.on('failed', (job, err) => console.error(`[ReportingWorker] Job ${job?.id} failed:`, err));

console.log('[ReportingWorker] Started. Listening on ReportingQueue...');
