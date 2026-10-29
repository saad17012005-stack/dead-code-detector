import { CallGraph, DeadCodeFinding, SymbolNode } from '../types';
import { DependencyGraph } from '../graph/dependency-graph';

export class DeadCodeDetector {
  public detect(dependencyGraph: DependencyGraph, callGraph: CallGraph, entryPoints: string[]): DeadCodeFinding[] {
    const findings: DeadCodeFinding[] = [];
    const files = dependencyGraph.getFiles();

    // 1. Identify unreferenced exports
    // In a real implementation, we'd traverse the call graph from entryPoints.
    // For now, we simulate static reachability by flagging exported symbols that have no incoming edges.
    
    // Compute incoming edges count for each node
    const incomingEdges = new Map<string, number>();
    for (const edge of callGraph.edges) {
      const count = incomingEdges.get(edge.toId) || 0;
      incomingEdges.set(edge.toId, count + 1);
    }

    for (const [nodeId, symbol] of callGraph.nodes.entries()) {
      // If it's an export and has no incoming edges, and is not from an entry point file
      const isEntryPoint = entryPoints.some(ep => symbol.filePath.includes(ep));
      
      if (symbol.isExported && !isEntryPoint) {
        const refs = incomingEdges.get(nodeId) || 0;
        if (refs === 0) {
          findings.push({
            id: `unused_export_${nodeId}`,
            category: 'UNUSED_EXPORT',
            symbol,
            filePath: symbol.filePath,
            loc: symbol.loc,
          });
        }
      }
    }

    // 2. Identify orphan files
    // Files that are never imported
    const importedFiles = new Set<string>();
    for (const [filePath, fileNode] of files.entries()) {
      for (const imp of fileNode.imports) {
        // A full implementation would resolve the module path 'imp' to an absolute file path.
        // We'll skip the resolution logic for this skeleton.
        importedFiles.add(imp);
      }
    }

    for (const [filePath, fileNode] of files.entries()) {
      const isEntryPoint = entryPoints.some(ep => filePath.includes(ep));
      // Simplified check for orphan files
      if (!isEntryPoint && false /* actually check if resolved filePath is in importedFiles */) {
        findings.push({
          id: `orphan_file_${filePath}`,
          category: 'ORPHAN_FILE',
          filePath,
        });
      }
    }

    return findings;
  }
}
