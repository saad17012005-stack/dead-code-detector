export * from './types';
export * from './parser/ast-parser';
export * from './graph/dependency-graph';
export * from './graph/call-graph';
export * from './analyzer/dead-code-detector';
export * from './ai/llm-verifier';
export * from './reporters/sarif-reporter';

import { AnalysisConfig, AnalysisReport } from './types';
import { DependencyGraph } from './graph/dependency-graph';
import { CallGraphBuilder } from './graph/call-graph';
import { DeadCodeDetector } from './analyzer/dead-code-detector';
import { LLMVerifier } from './ai/llm-verifier';

export async function analyzeProject(config: AnalysisConfig): Promise<AnalysisReport> {
  const depGraph = new DependencyGraph();
  await depGraph.build(config.entryPoints, config.excludePatterns);

  const callGraphBuilder = new CallGraphBuilder();
  const callGraph = callGraphBuilder.build(depGraph);

  const detector = new DeadCodeDetector();
  let findings = detector.detect(depGraph, callGraph, config.entryPoints);

  // LLM Verification (Stage 6) is now decoupled from the core detection pipeline
  // and will be executed via a dedicated worker post-reporting.

  const rawFunctions: import('./types').RawFunction[] = [];
  
  // Extract all function definitions for downstream workers
  const fs = require('fs');
  for (const [filePath, fileNode] of depGraph.getFiles().entries()) {
    try {
      const codeStr = fs.readFileSync(filePath, 'utf-8');
      const lines = codeStr.split('\\n');
      
      for (const symbol of fileNode.symbols.values()) {
        if (symbol.type === 'function' && symbol.loc) {
          // Extract exact lines for this function
          const fnLines = lines.slice(symbol.loc.start.line - 1, symbol.loc.end.line);
          const snippet = fnLines.join('\\n');
          rawFunctions.push({
            name: symbol.name,
            file_path: filePath,
            code: snippet,
            commit_hash: 'HEAD', // Would be enriched by Git layer ideally
            commit_date: new Date().toISOString()
          });
        }
      }
    } catch(e) {
      // ignore unreadable files
    }
  }

  return {
    timestamp: new Date().toISOString(),
    filesScanned: depGraph.getFiles().size,
    totalFindings: findings.length,
    findings,
    rawFunctions
  };
}
