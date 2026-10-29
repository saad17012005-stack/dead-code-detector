import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import crypto from 'crypto';

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

const MAX_TIME_DELTA_MINUTES = 60; // Δt

// 1. Bot-tag detection
function detectBotTags(commitMsg: string, author: string): string[] {
  const markers: string[] = [];
  
  // Strict regex for known bot trailers at line starts, and known bot suffixes in author strings
  const trailerRegex = /^Co-authored-by:.*(copilot|claude|cursor|gemini)/im;
  const generatedRegex = /^Generated with (claude|copilot|cursor|gemini)/im;
  const authorRegex = /\[bot\]|copilot|claude|cursor|gemini/i;
  
  if (trailerRegex.test(commitMsg) || generatedRegex.test(commitMsg) || authorRegex.test(author)) {
    markers.push('bot-tag');
  }
  
  return markers;
}

// 2. Changelog-disclosed
function detectChangelogDisclosed(changelogContent: string): string[] {
  const markers: string[] = [];
  
  const aiGeneratedRegex = /\bai[- ]generated\b/i;
  const toolPattern = "(copilot|claude|cursor|gemini|chatgpt|openai)";
  const actionPattern = "(generated|written\\s+by|assisted\\s+by|co-authored\\s+by)";
  
  const toolFirst = new RegExp(`\\\\b${toolPattern}\\\\b.{0,50}\\\\b${actionPattern}\\\\b`, 'i');
  const actionFirst = new RegExp(`\\\\b${actionPattern}\\\\b.{0,50}\\\\b${toolPattern}\\\\b`, 'i');
  
  if (aiGeneratedRegex.test(changelogContent) || toolFirst.test(changelogContent) || actionFirst.test(changelogContent)) {
    markers.push('changelog-disclosed');
  }
  
  return markers;
}

function detectAuthorshipMarkers(commitMsg: string, author: string, changelogContent: string): string[] {
  return [
    ...detectBotTags(commitMsg, author),
    ...detectChangelogDisclosed(changelogContent)
  ];
}

import { simpleGit } from 'simple-git';

// Fetch commit metadata
async function getCommitMetadata(hash: string, repoPath: string = '.') {
  try {
    const git = simpleGit(repoPath);
    const log = await git.log(['-1', hash]);
    
    if (log.latest) {
      const { message, body, author_name, author_email, date } = log.latest;
      const fullMsg = `${message}\n\n${body}`;
      
      return {
        commitMsg: fullMsg,
        author: `${author_name} <${author_email}>`,
        changelogContent: fullMsg, // Fallback for local git (PR/Changelog typically in body)
        commitTime: new Date(date)
      };
    }
  } catch (err) {
    console.error(`[ProvenanceWorker] Failed to get git log for ${hash}:`, err);
  }

  // Fallback
  return {
    commitMsg: '',
    author: '',
    changelogContent: '',
    commitTime: new Date()
  };
}

async function processCandidate(jobData: any) {
  const { scan_run_id, pattern_type, functions, evidence } = jobData;
  const candidate_id = `cand_${crypto.randomBytes(8).toString('hex')}`;
  
  // 1. Fetch commit metadata and evaluate markers
  let allMarkers: string[] = [];
  let commitTimes: Date[] = [];
  
  for (const fn of functions) {
    const meta = await getCommitMetadata(fn.commit_hash);
    const markers = detectAuthorshipMarkers(meta.commitMsg, meta.author, meta.changelogContent);
    allMarkers.push(...markers);
    commitTimes.push(meta.commitTime);
  }
  
  allMarkers = [...new Set(allMarkers)];
  
  let confidence = 'provenance_unclear';
  
  // Rules for confidence: high
  const hasAIMarker = allMarkers.length > 0;
  let isWithinTimeDelta = false;
  let definition = 'unknown';
  
  if (pattern_type === 'near_duplicate') {
    // Requires time delta check
    if (commitTimes.length >= 2) {
      const deltaMs = Math.abs(commitTimes[0].getTime() - commitTimes[1].getTime());
      const deltaMins = deltaMs / (1000 * 60);
      isWithinTimeDelta = deltaMins <= MAX_TIME_DELTA_MINUTES;
    }
    
    if (hasAIMarker && isWithinTimeDelta) {
      confidence = 'high';
    }
    // Near duplicate is Definition 1 (or 4 if provenance applies)
    // As per spec, provenance correlation is Stage 4 (Definition 4) applied to Def 1
    definition = '1'; 
  } else if (pattern_type === 'rbu') {
    // RBU definition just needs an AI marker for the unreachable block
    if (hasAIMarker) {
      confidence = 'high';
    }
    definition = '2'; // RBU is Definition 2
  }
  
  const suggested_action = pattern_type === 'near_duplicate' ? 'review_for_merge' : 'review_for_removal';
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Insert Candidate
    await client.query(
      `INSERT INTO candidates (id, scan_run_id, pattern_type, confidence, suggested_action, definition)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [candidate_id, scan_run_id, pattern_type, confidence, suggested_action, definition]
    );
    
    // Insert Functions
    for (const fn of functions) {
      await client.query(
        `INSERT INTO candidate_functions (candidate_id, name, file, commit_hash, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [candidate_id, fn.name, fn.file, fn.commit_hash, fn.role || 'primary']
      );
    }
    
    // Insert Evidence
    await client.query(
      `INSERT INTO candidate_evidence (candidate_id, semantic_similarity, lexical_similarity, commit_time_delta_minutes, reachable, production_call_sites, ai_authorship_markers)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        candidate_id, 
        evidence.semantic_similarity ?? null, 
        evidence.lexical_similarity ?? null, 
        evidence.commit_time_delta_minutes ?? null, 
        evidence.reachable ?? null,
        evidence.production_call_sites ?? null,
        JSON.stringify(allMarkers)
      ]
    );
    
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  
  return { candidate_id, confidence };
}

const worker = new Worker(
  'ProvenanceQueue',
  async (job: Job) => {
    console.log(`[ProvenanceWorker] Processing job ${job.id}`);
    const result = await processCandidate(job.data);
    console.log(`[ProvenanceWorker] Job ${job.id} produced candidate ${result.candidate_id} with confidence ${result.confidence}`);
    return result;
  },
  { connection }
);

worker.on('completed', (job) => console.log(`[ProvenanceWorker] Job ${job.id} completed.`));
worker.on('failed', (job, err) => console.error(`[ProvenanceWorker] Job ${job?.id} failed:`, err));

console.log('[ProvenanceWorker] Started. Listening on ProvenanceQueue...');
