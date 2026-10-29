import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import axios from 'axios';

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

const API_KEY = process.env.LLM_VERIFIER_API_KEY;
if (!API_KEY) {
  console.info('[LLMVerifierWorker] Info: LLM_VERIFIER_API_KEY is unset or empty. Stage 6 (LLM Verification) will be skipped cleanly.');
}

async function verifyWithLLM(functions: any[]) {
  try {
    const prompt = `Analyze the following functions and determine if they are functionally dead code.
Respond ONLY with a valid JSON object matching this schema:
{
  "verdict": "verified_dead" | "verified_alive" | "uncertain",
  "rationale": "string explaining the reasoning"
}

Functions:
${JSON.stringify(functions)}
`;

    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent',
      {
        contents: [{ parts: [{ text: prompt }] }]
      },
      {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY }
      }
    );
    
    const candidateText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return { verdict: 'error', rationale: 'LLM returned an empty or malformed response structure.' };
    }

    try {
      const cleanedText = candidateText.replace(/^```json\\s*/im, '').replace(/```\\s*$/im, '').trim();
      const parsed = JSON.parse(cleanedText);

      if (!parsed.verdict || !['verified_dead', 'verified_alive', 'uncertain'].includes(parsed.verdict)) {
        return { verdict: 'error', rationale: `LLM returned invalid verdict: ${parsed.verdict}` };
      }
      
      return {
        verdict: parsed.verdict,
        rationale: parsed.rationale || 'No rationale provided by LLM.'
      };
    } catch (parseError: any) {
      return { verdict: 'error', rationale: `Failed to parse JSON: ${parseError.message}. Raw: ${candidateText.substring(0, 100)}` };
    }
  } catch (error: any) {
    if (error.response) {
      const status = error.response.status;
      if (status === 429 || status >= 500) {
        throw error; // Let BullMQ retry for transient errors
      }
      return { verdict: 'error', rationale: `API Error: ${status} - ${error.response.statusText}` };
    }
    return { verdict: 'error', rationale: `Network Error: ${error.message}` };
  }
}

async function processVerification(job: Job) {
  if (!API_KEY) {
    // Stage 6 skipped entirely.
    return { skipped: true };
  }

  const { candidate_id } = job.data;

  try {
    const res = await pool.query(`
      SELECT c.*, json_agg(json_build_object('name', cf.name, 'file', cf.file, 'commit', cf.commit_hash)) as functions
      FROM candidates c
      JOIN candidate_functions cf ON c.id = cf.candidate_id
      WHERE c.id = $1
      GROUP BY c.id
    `, [candidate_id]);

    if (res.rows.length === 0) return { error: 'Candidate not found' };
    
    const candidate = res.rows[0];

    // Call LLM API
    const llmResult = await verifyWithLLM(candidate.functions);

    // Save to DB
    await pool.query(
      `UPDATE candidates SET llm_verification = $1 WHERE id = $2`,
      [JSON.stringify(llmResult), candidate_id]
    );

    return llmResult;
  } catch (e: any) {
    throw e; // Will trigger BullMQ retry logic if it bubbles up
  }
}

const worker = new Worker(
  'LlmVerificationQueue',
  async (job: Job) => {
    if (!API_KEY) return { skipped: true };
    console.log(`[LLMVerifierWorker] Processing verification for candidate ${job.data.candidate_id}`);
    return processVerification(job);
  },
  { 
    connection,
    settings: {
      backoffStrategy: (attemptsMade: number) => Math.pow(2, attemptsMade) * 1000,
    }
  }
);

worker.on('completed', (job) => {
  if ((job.returnvalue as any)?.skipped) return; // Silent skip
  console.log(`[LLMVerifierWorker] Job ${job.id} completed.`);
});
worker.on('failed', (job, err) => {
  if (!API_KEY) return;
  console.error(`[LLMVerifierWorker] Job ${job?.id} failed:`, err);
});

console.log('[LLMVerifierWorker] Started. Listening on LlmVerificationQueue...');
