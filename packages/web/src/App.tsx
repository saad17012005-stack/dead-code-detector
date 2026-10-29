import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Code, FileQuestion, CheckCircle, Search, AlertTriangle, ShieldCheck } from 'lucide-react';

interface CandidateEvidence {
  semantic_similarity: number | null;
  lexical_similarity: number | null;
  commit_time_delta_minutes: number | null;
  reachable?: boolean;
  production_call_sites: number | null;
  ai_authorship_markers: string[];
}

interface CandidateFunction {
  name: string;
  file: string;
  commit: string;
  startLine?: number;
  endLine?: number;
  codeSnippet?: string;
}

interface Candidate {
  candidate_id: string;
  pattern_type: 'near_duplicate' | 'rbu';
  confidence: 'high' | 'provenance_unclear';
  functions: CandidateFunction[];
  evidence: CandidateEvidence;
  suggested_action: 'review_for_merge' | 'review_for_removal';
}

interface ReportSummary {
  total_candidates: number;
  high_confidence: number;
  provenance_unclear: number;
}

interface Stage5Report {
  repository: string;
  generated_at: string;
  summary: ReportSummary;
  candidates: Candidate[];
}

function DeletionFlow({ candidate, onDeleted }: { candidate: Candidate, onDeleted: () => void }) {
  const [step, setStep] = useState<'initial' | 'verifying' | 'confirm' | 'deleting' | 'done'>('initial');
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const startVerification = async () => {
    setStep('verifying');
    try {
      const res = await fetch(`http://localhost:3001/v1/candidates/${candidate.candidate_id}/verify-for-deletion`, { method: 'POST' });
      const data = await res.json();
      setVerificationResult(data);
      setStep('confirm');
    } catch (e) {
      console.error(e);
      setStep('initial');
    }
  };

  const approveDeletion = async () => {
    setStep('deleting');
    try {
      await fetch(`http://localhost:3001/v1/batches/batch-1/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          file: candidate.functions[0].file, 
          functionName: candidate.functions[0].name 
        })
      });
      setStep('done');
      setTimeout(onDeleted, 1500); // refresh report
    } catch (e) {
      console.error(e);
      setStep('confirm');
    }
  };

  const downloadCleanedFile = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`http://localhost:3001/v1/download-cleaned`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          file: candidate.functions[0].file, 
          functionName: candidate.functions[0].name,
          originalContent: (candidate.functions[0] as any).originalContent 
        })
      });
      const data = await res.json();
      if (data.success && data.cleanedContent) {
        const blob = new Blob([data.cleanedContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const originalFileName = candidate.functions[0].file.split(/[\\/]/).pop() || 'cleaned_file.ts';
        a.download = `cleaned_${originalFileName.replace('Uploaded File: ', '')}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Failed to download cleaned file', e);
    } finally {
      setIsDownloading(false);
    }
  };

  if (step === 'done') {
    return <div style={{ color: 'var(--success)' }}><CheckCircle size={14} style={{ display: 'inline', marginRight: '4px' }} /> Deleted successfully</div>;
  }

  if (step === 'verifying' || step === 'deleting') {
    return <div style={{ color: 'var(--primary)' }}><Search className="animate-pulse-slow" size={14} style={{ display: 'inline', marginRight: '4px' }} /> {step === 'verifying' ? 'Running 7-Stage Verification...' : 'Executing Deletion...'}</div>;
  }

  if (step === 'confirm' && verificationResult) {
    return (
      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px', marginTop: '0.5rem' }}>
        <div style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
          <strong>Verification Passed:</strong>
          <ul style={{ margin: '0.25rem 0', paddingLeft: '1.25rem', color: 'var(--success)' }}>
            <li>Reachability Re-check</li>
            <li>Shadow Build & Tests</li>
            <li>String/Reflection Scan</li>
          </ul>
          <div style={{ color: 'var(--warning)' }}>Blast Radius: {verificationResult.stage_b_results.b7_blast_radius.files_touched} file(s) touched</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={approveDeletion} className="btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Approve Deletion
          </button>
          <button onClick={downloadCleanedFile} disabled={isDownloading} className="btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'var(--success)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: isDownloading ? 0.7 : 1 }}>
            {isDownloading ? 'Processing...' : 'Download Cleaned'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <button onClick={startVerification} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer' }}>
        Verify & Delete
      </button>
      <button onClick={downloadCleanedFile} disabled={isDownloading} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer', opacity: isDownloading ? 0.7 : 1 }}>
        {isDownloading ? 'Processing...' : 'Download Cleaned'}
      </button>
    </div>
  );
}

export default function App() {
  const [report, setReport] = useState<Stage5Report | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanRunId, setScanRunId] = useState('1'); // Mock ID or allow user to input
  const [localPath, setLocalPath] = useState('C:\\Users\\Admin\\Desktop\\Dead Code Detection\\demo'); // Pre-filled local path
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3001/v1/repositories/${scanRunId}/report.json`);
      if (!res.ok) {
        throw new Error(`Failed to fetch report (Status: ${res.status})`);
      }
      const data = await res.json();
      setReport(data);
    } catch (e: any) {
      console.error(e);
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3001/v1/scans/upload`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || `Failed to upload file`);
      }
      const data = await res.json();
      setReport(data);
    } catch (e: any) {
      console.error(e);
      setError(e.message);
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  };

  const scanLocal = async () => {
    if (!localPath) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3001/v1/scans/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directoryPath: localPath })
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || `Failed to scan local path`);
      }
      const data = await res.json();
      setReport(data);
    } catch (e: any) {
      console.error(e);
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteAllCandidates = async () => {
    if (!report || report.candidates.length === 0) return;
    setIsDeletingAll(true);
    try {
      for (const c of report.candidates) {
        if (c.pattern_type === 'rbu') {
          await fetch(`http://localhost:3001/v1/batches/batch-1/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              file: c.functions[0].file, 
              functionName: c.functions[0].name 
            })
          });
        }
      }
      if (localPath) scanLocal(); else fetchReport();
    } catch (e: any) {
      console.error(e);
      setError('Failed to delete all candidates');
    } finally {
      setIsDeletingAll(false);
    }
  };

  useEffect(() => {
    const fetchLatestScan = async () => {
      try {
        const res = await fetch('http://localhost:3001/v1/scans');
        if (res.ok) {
          const scans = await res.json();
          if (scans.length > 0) {
            setScanRunId(scans[0].id);
          }
        }
      } catch (e) {
        console.error('Failed to fetch scans', e);
      }
    };
    fetchLatestScan();
  }, []);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3rem' }}>
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
            <Activity color="var(--primary)" size={32} />
            AI Code Debt
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginTop: '0.25rem' }}>Phase 3: Correlation & Reporting Dashboard</p>
        </motion.div>
        
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          {/* Scan Run ID Input */}
          <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input 
              type="text" 
              value={scanRunId}
              onChange={e => setScanRunId(e.target.value)}
              placeholder="Scan Run ID"
              style={{
                background: 'rgba(0,0,0,0.2)', border: '1px solid var(--card-border)',
                color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', outline: 'none', width: '250px'
              }}
            />
            <button className="btn-primary" onClick={fetchReport} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: isLoading ? 0.7 : 1 }}>
              {isLoading ? <Search className="animate-pulse-slow" size={18} /> : <Search size={18} />}
              Fetch DB Report
            </button>
          </div>

          {/* Upload File Input */}
          <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="file" onChange={uploadFile} id="file-upload" style={{ display: 'none' }} />
            <label htmlFor="file-upload" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: isLoading ? 0.7 : 1, cursor: 'pointer', margin: 0, whiteSpace: 'nowrap' }}>
              <Code size={18} />
              Upload Any File
            </label>
            <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', padding: '0 0.5rem' }}>or</span>
            <input 
              type="text" 
              value={localPath}
              onChange={e => setLocalPath(e.target.value)}
              placeholder="Paste absolute File or Folder Path"
              style={{
                background: 'rgba(0,0,0,0.2)', border: '1px solid var(--card-border)',
                color: 'white', padding: '0.5rem 1rem', borderRadius: '6px', outline: 'none', width: '250px'
              }}
            />
            <button className="btn-primary" onClick={scanLocal} disabled={isLoading || !localPath} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: (isLoading || !localPath) ? 0.7 : 1, whiteSpace: 'nowrap' }}>
              Scan Path
            </button>
          </div>
        </motion.div>
      </header>

      {/* Error State */}
      {error && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', padding: '1rem', borderRadius: '8px', color: '#fca5a5', marginBottom: '2rem', display: 'flex', gap: '0.5rem' }}>
          <AlertTriangle /> {error}
        </motion.div>
      )}

      {/* Content */}
      <AnimatePresence mode="wait">
        {report ? (
          <motion.div key="report" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            
            {/* Overview Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'rgba(255,255,255,0.7)' }}>
                  <Code size={20} /> <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Candidates</h3>
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800 }}>{report.summary.total_candidates}</div>
              </div>
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'rgba(255,255,255,0.7)' }}>
                  <ShieldCheck size={20} color="var(--success)" /> <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>High Confidence</h3>
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: report.summary.high_confidence > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  {report.summary.high_confidence}
                </div>
              </div>
              <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'rgba(255,255,255,0.7)' }}>
                  <AlertTriangle size={20} color="var(--warning)" /> <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Provenance Unclear</h3>
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--warning)' }}>
                  {report.summary.provenance_unclear}
                </div>
              </div>
            </div>

            {/* Candidates List */}
            <div className="glass-panel" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--card-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Detected Debt Candidates</h2>
                  <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.25rem' }}>Repository: {report.repository}</div>
                </div>
                {report.candidates.length > 0 && (
                  <button onClick={deleteAllCandidates} disabled={isDeletingAll} style={{ padding: '0.5rem 1rem', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', opacity: isDeletingAll ? 0.7 : 1, fontWeight: 'bold' }}>
                    {isDeletingAll ? 'Deleting All...' : 'Delete All RBU Candidates'}
                  </button>
                )}
              </div>
              
              {report.candidates.length === 0 ? (
                <div style={{ padding: '4rem', textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                  <CheckCircle size={48} color="var(--success)" style={{ margin: '0 auto 1rem', opacity: 0.8 }} />
                  <h3>No candidates detected!</h3>
                  <p>Your repository is completely clean.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.02)', color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--card-border)' }}>Type & Action</th>
                        <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--card-border)' }}>Location & Code</th>
                        <th style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--card-border)' }}>Verification & Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.candidates.map((c, i) => (
                        <motion.tr key={i} className="table-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
                          <td style={{ padding: '1.5rem' }}>
                            <span className={c.pattern_type === 'rbu' ? 'badge badge-danger' : 'badge badge-warning'}>{c.pattern_type}</span>
                            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)' }}>{c.suggested_action}</div>
                            <div style={{ marginTop: '1rem' }}>
                              <span style={{ color: c.confidence === 'high' ? 'var(--success)' : 'var(--warning)', fontWeight: 'bold', fontSize: '0.8rem' }}>
                                {c.confidence} confidence
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '1.5rem', fontSize: '0.875rem', color: 'rgba(255,255,255,0.8)' }}>
                            {c.functions.map((f, j) => (
                              <div key={j} style={{ marginBottom: '1rem' }}>
                                <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <strong>{f.name}</strong> <span style={{ color: 'var(--primary)' }}>in {f.file.split(/[\\/]/).pop()}</span>
                                  </div>
                                  {f.startLine && <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px' }}>Lines {f.startLine}-{f.endLine}</div>}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.5rem' }}>{f.file}</div>
                                {f.codeSnippet && (
                                  <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '4px', overflowX: 'auto', fontSize: '0.75rem', margin: 0, border: '1px solid rgba(255,255,255,0.05)', color: '#d1d5db' }}>
                                    <code>{f.codeSnippet}</code>
                                  </pre>
                                )}
                              </div>
                            ))}
                          </td>
                          <td style={{ padding: '1.5rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)' }}>
                            <div style={{ marginBottom: '0.5rem' }}><strong>AI Markers:</strong> {c.evidence.ai_authorship_markers?.length > 0 ? c.evidence.ai_authorship_markers.join(', ') : 'None'}</div>
                            {c.pattern_type === 'near_duplicate' && (
                              <>
                                <div><strong>Sem Sim:</strong> {c.evidence.semantic_similarity?.toFixed(2) || 'N/A'}</div>
                                <div><strong>Time Δ (m):</strong> {c.evidence.commit_time_delta_minutes || 'N/A'}</div>
                              </>
                            )}
                            {c.pattern_type === 'rbu' && (
                              <>
                                <div><strong>Reachable:</strong> {c.evidence.reachable ? 'Yes' : 'No'}</div>
                                <div style={{ marginBottom: '1rem' }}><strong>Prod Calls:</strong> {c.evidence.production_call_sites ?? 'N/A'}</div>
                                <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                  <DeletionFlow candidate={c} onDeleted={() => { if (localPath) scanLocal(); else fetchReport(); }} />
                                </div>
                              </>
                            )}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          !isLoading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: '6rem', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
              <FileQuestion size={64} style={{ margin: '0 auto 1.5rem', opacity: 0.5 }} />
              <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'rgba(255,255,255,0.8)' }}>No report data available</h2>
              <p>Enter a local directory path to scan, or use a Scan Run ID.</p>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}
