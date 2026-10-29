import { globby } from 'globby';
import * as path from 'path';
import { ASTParser } from '../parser/ast-parser';
import { SourceFileNode } from '../types';

export class DependencyGraph {
  private files: Map<string, SourceFileNode> = new Map();
  private parser: ASTParser;

  constructor() {
    this.parser = new ASTParser();
  }

  public async build(entryPoints: string[], excludePatterns: string[] = []): Promise<void> {
    const patterns = [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '!**/node_modules/**',
      '!**/dist/**',
      ...excludePatterns.map(p => `!${p}`)
    ];

    // Find all files based on entry points (for monorepo this could be the package directory)
    // Here we'll simplify and assume entryPoints are directories or globs
    const filePaths = await globby(patterns, { absolute: true });

    for (const filePath of filePaths) {
      try {
        const sourceFile = this.parser.parseFile(filePath);
        this.files.set(filePath, sourceFile);
      } catch (err) {
        console.warn(`Failed to parse file: ${filePath}`, err);
      }
    }
  }

  public getFiles(): Map<string, SourceFileNode> {
    return this.files;
  }

  public getFile(filePath: string): SourceFileNode | undefined {
    return this.files.get(filePath);
  }
}
