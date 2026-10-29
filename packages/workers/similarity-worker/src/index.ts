import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import axios from 'axios';

// Constants and Thresholds
const THRESHOLD_SEMANTIC = 0.85; // θ
const THRESHOLD_LEXICAL = 0.6; // τ
const MAX_TIME_DELTA_MINUTES = 60; // Δt

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

// Helper for Lexical Similarity (Jaccard Index on tokens)
function computeLexicalSimilarity(codeA: string, codeB: string): number {
  const setA = new Set(codeA.split(/\\W+/).filter(Boolean));
  const setB = new Set(codeB.split(/\\W+/).filter(Boolean));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 1.0;
  return intersection.size / union.size;
}

// 1. Semantic Check
async function passesSemanticSimilarity(hashA: string, hashB: string): Promise<boolean> {
  // Uses pgvector cosine distance `<=>` operator (returns distance, so similarity is 1 - distance)
  const result = await pool.query(
    `SELECT 1 - (e1.vector <=> e2.vector) AS similarity 
     FROM function_embeddings e1, function_embeddings e2
     WHERE e1.content_hash = $1 AND e2.content_hash = $2`,
    [hashA, hashB]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].similarity > THRESHOLD_SEMANTIC;
}

// 2. Lexical Check
function passesLexicalSimilarity(codeA: string, codeB: string): boolean {
  return computeLexicalSimilarity(codeA, codeB) < THRESHOLD_LEXICAL;
}

// 3. Time Delta Check
function passesTimeDelta(commitTimeA: Date, commitTimeB: Date): boolean {
  const deltaMs = Math.abs(commitTimeA.getTime() - commitTimeB.getTime());
  const deltaMins = deltaMs / (1000 * 60);
  return deltaMins < MAX_TIME_DELTA_MINUTES;
}

import * as vm from 'vm';

// 4. Behavioral Check
async function passesBehavioralCheck(funcA: any, funcB: any): Promise<boolean> {
  const inputs = [
    [],
    [1],
    ["test"],
    [{ a: 1 }],
    [0, false],
    [null]
  ];

  for (const args of inputs) {
    let resA, resB, errA, errB;
    
    const sandboxA = { result: null as any, args };
    const sandboxB = { result: null as any, args };

    try {
      const scriptA = new vm.Script(`
        ${funcA.code}
        result = ${funcA.name}(...args);
      `);
      scriptA.runInNewContext(sandboxA, { timeout: 100 });
      resA = sandboxA.result;
    } catch (e) { errA = e; }

    try {
      const scriptB = new vm.Script(`
        ${funcB.code}
        result = ${funcB.name}(...args);
      `);
      scriptB.runInNewContext(sandboxB, { timeout: 100 });
      resB = sandboxB.result;
    } catch (e) { errB = e; }

    if (errA || errB) {
      if (!!errA !== !!errB) return false; // One threw, one didn't -> different behavior
      continue; // Both threw -> same behavior
    }

    if (JSON.stringify(resA) !== JSON.stringify(resB)) {
      return false;
    }
  }

  return true;
}

// Get or create embeddings from Python embedding service
async function ensureEmbeddings(functions: any[]) {
  const missing = [];
  
  for (const fn of functions) {
    const res = await pool.query('SELECT 1 FROM function_embeddings WHERE content_hash = $1', [fn.content_hash]);
    if (res.rows.length === 0) missing.push(fn);
  }

  if (missing.length > 0) {
    const response = await axios.post('http://127.0.0.1:8000/embed', {
      code_snippets: missing.map(m => m.code)
    });
    
    for (let i = 0; i < missing.length; i++) {
      const vectorStr = `[${response.data.embeddings[i].join(',')}]`;
      await pool.query(
        'INSERT INTO function_embeddings (content_hash, vector) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [missing[i].content_hash, vectorStr]
      );
    }
  }
}

const worker = new Worker(
  'SimilarityQueue',
  async (job: Job) => {
    console.log(`[SimilarityWorker] Processing job ${job.id}`);
    const { functions } = job.data;
    
    // Ensure all functions have cached embeddings in pgvector
    await ensureEmbeddings(functions);

    const candidates = [];
    
    // Only compare within same module/file context (avoiding N^2 across whole repo)
    for (let i = 0; i < functions.length; i++) {
      for (let j = i + 1; j < functions.length; j++) {
        const fnA = functions[i];
        const fnB = functions[j];
        
        // Only compare if they share the same file/module context
        if (fnA.file_path !== fnB.file_path) continue;

        // Condition 1: Semantic Similarity (pgvector)
        const isSemanticallySimilar = await passesSemanticSimilarity(fnA.content_hash, fnB.content_hash);
        
        // Condition 2: Lexical Similarity (Token Jaccard)
        const isLexicallyDifferent = passesLexicalSimilarity(fnA.code, fnB.code);
        
        // Condition 3: Time window
        const isRecent = passesTimeDelta(new Date(fnA.commit_date), new Date(fnB.commit_date));

        if (isSemanticallySimilar && isLexicallyDifferent && isRecent) {
           // Condition 4: Lightweight behavioral check
           const passesBehavior = await passesBehavioralCheck(fnA, fnB);
           if (passesBehavior) {
             candidates.push({ fnA, fnB });
           }
        }
      }
    }

    console.log(`[SimilarityWorker] Job ${job.id} found ${candidates.length} near-duplicate candidates.`);
    return candidates;
  },
  { connection }
);

worker.on('completed', (job) => console.log(`[SimilarityWorker] Job ${job.id} completed.`));
worker.on('failed', (job, err) => console.error(`[SimilarityWorker] Job ${job?.id} failed:`, err));

console.log('[SimilarityWorker] Started. Listening on SimilarityQueue...');
