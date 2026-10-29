import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import madge from 'madge';
import * as path from 'path';

const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
});

async function computeReachability(entryPoints: string[], allFiles: string[]) {
  // We use madge to build a file-level dependency graph of the entire repository
  console.log('[ReachabilityWorker] Generating whole-repository call graph...');
  
  const res = await madge(allFiles, {
    fileExtensions: ['js', 'jsx', 'ts', 'tsx'],
    excludeRegExp: [
      /node_modules/, 
      /\\.test\\.tsx?$/, 
      /\\.spec\\.tsx?$/, 
      /__tests__/
    ]
  });

  const graph = res.obj();
  
  // Trace from production entry points (e.g. Next.js pages, API routes, explicit exports)
  // Filtering out tests is already done via excludeRegExp, but we ensure entryPoints are clean
  const prodEntryPoints = entryPoints.filter(ep => !ep.includes('.test.') && !ep.includes('.spec.'));

  // Simple BFS/DFS to find all reachable nodes from the production entry points
  const reachableFromProd = new Set<string>();
  const queue = [...prodEntryPoints];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (!reachableFromProd.has(node)) {
      reachableFromProd.add(node);
      
      const dependencies = graph[node] || [];
      for (const dep of dependencies) {
        if (!reachableFromProd.has(dep)) {
          queue.push(dep);
        }
      }
    }
  }

  const rbuCandidates = [];
  
  // A file is an RBU candidate if it exists in the graph (i.e. is statically imported somewhere)
  // BUT is absent from every traced production path (Prod(f) = 0).
  for (const file of Object.keys(graph)) {
    const isReachableStatically = Object.values(graph).some(deps => deps.includes(file));
    
    // Reach(f) == 1 && Prod(f) == 0
    if (isReachableStatically && !reachableFromProd.has(file)) {
      rbuCandidates.push(file);
    }
  }

  return rbuCandidates;
}

const worker = new Worker(
  'ReachabilityQueue',
  async (job: Job) => {
    console.log(`[ReachabilityWorker] Processing job ${job.id}`);
    const { entryPoints, allFiles } = job.data;
    
    // Convert paths relative to madge root
    const rbuCandidates = await computeReachability(entryPoints, allFiles);
    
    console.log(`[ReachabilityWorker] Job ${job.id} found ${rbuCandidates.length} RBU candidates.`);
    
    // Return them strictly separated from baseline findings and similarity findings
    return rbuCandidates;
  },
  { connection }
);

worker.on('completed', (job) => console.log(`[ReachabilityWorker] Job ${job.id} completed.`));
worker.on('failed', (job, err) => console.error(`[ReachabilityWorker] Job ${job?.id} failed:`, err));

console.log('[ReachabilityWorker] Started. Listening on ReachabilityQueue...');
