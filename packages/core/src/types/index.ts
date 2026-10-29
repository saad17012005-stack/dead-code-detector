export type DeadCodeCategory =
  | 'UNUSED_EXPORT'
  | 'UNREACHABLE_FUNCTION'
  | 'DEAD_BRANCH'
  | 'OBSOLETE_FLAG'
  | 'UNREFERENCED_TYPE'
  | 'ORPHAN_FILE';

export interface Position {
  line: number;
  column: number;
}

export interface SourceLocation {
  start: Position;
  end: Position;
}

export interface SymbolNode {
  id: string; // e.g. "filepath#symbolName"
  name: string;
  type: 'function' | 'class' | 'variable' | 'type' | 'export' | 'import' | 'jsx_component';
  filePath: string;
  loc?: SourceLocation;
  isExported: boolean;
}

export interface SourceFileNode {
  filePath: string;
  symbols: Map<string, SymbolNode>;
  imports: string[];
  exports: string[];
}

export interface ReferenceEdge {
  fromId: string;
  toId: string;
  type: 'import' | 'call' | 'reference' | 'type_reference';
  loc?: SourceLocation;
}

export interface CallGraph {
  nodes: Map<string, SymbolNode>;
  edges: ReferenceEdge[];
}

export interface ConfidenceScore {
  score: number; // 0.0 to 1.0
  reasoning: string;
}

export interface DeadCodeFinding {
  id: string;
  category: DeadCodeCategory;
  symbol?: SymbolNode;
  filePath: string;
  loc?: SourceLocation;
  confidence?: ConfidenceScore;
  suggestedFix?: string; // diff or replacement string
}

export interface AnalysisConfig {
  entryPoints: string[];
  excludePatterns?: string[];
  enableAiVerification?: boolean;
}

export interface RawFunction {
  name: string;
  file_path: string;
  code: string;
  commit_hash?: string;
  commit_date?: string;
}

export interface AnalysisReport {
  timestamp: string;
  filesScanned: number;
  totalFindings: number;
  findings: DeadCodeFinding[];
  rawFunctions?: RawFunction[];
}

// --- Phase 3 / Stage 5 Schema ---

export interface CandidateFunction {
  name: string;
  file: string;
  commit: string;
}

export interface CandidateEvidence {
  semantic_similarity: number | null;
  lexical_similarity: number | null;
  commit_time_delta_minutes: number | null;
  reachable?: boolean;
  production_call_sites: number | null;
  ai_authorship_markers: string[];
}

export interface Candidate {
  candidate_id: string;
  pattern_type: 'near_duplicate' | 'rbu';
  confidence: 'high' | 'provenance_unclear';
  definition: '1' | '2' | '4';
  functions: CandidateFunction[];
  evidence: CandidateEvidence;
  suggested_action: 'review_for_merge' | 'review_for_removal';
  llm_verification?: {
    verdict: string;
    rationale: string;
  };
}

export interface ReportSummary {
  total_candidates: number;
  high_confidence: number;
  provenance_unclear: number;
}

export interface Stage5Report {
  repository: string;
  generated_at: string;
  summary: ReportSummary;
  candidates: Candidate[];
}
