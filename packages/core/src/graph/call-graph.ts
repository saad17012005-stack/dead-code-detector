import { CallGraph, ReferenceEdge, SymbolNode } from '../types';
import { DependencyGraph } from './dependency-graph';

export class CallGraphBuilder {
  private graph: CallGraph = {
    nodes: new Map(),
    edges: []
  };

  public build(dependencyGraph: DependencyGraph): CallGraph {
    const files = dependencyGraph.getFiles();

    // Populate all symbol nodes
    for (const [filePath, fileNode] of files.entries()) {
      for (const [symbolId, symbol] of fileNode.symbols.entries()) {
        this.graph.nodes.set(symbolId, symbol);
      }
    }

    // A complete implementation would parse AST again (or cache traversal) 
    // to find CallExpressions and Identifier references to build accurate edges.
    // For this boilerplate, we'll keep the edges empty but ready for expansion.
    // E.g. If function A calls function B, we add:
    // this.graph.edges.push({ fromId: A, toId: B, type: 'call' });

    return this.graph;
  }
}
