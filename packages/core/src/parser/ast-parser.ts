import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';
import { SourceFileNode, SymbolNode, SourceLocation } from '../types';

export class ASTParser {
  public parseFile(filePath: string): SourceFileNode {
    const code = fs.readFileSync(filePath, 'utf-8');
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
    });

    const symbols = new Map<string, SymbolNode>();
    const imports: string[] = [];
    const exports: string[] = [];

    const getLoc = (nodeLoc: any): SourceLocation | undefined => {
      if (!nodeLoc) return undefined;
      return {
        start: { line: nodeLoc.start.line, column: nodeLoc.start.column },
        end: { line: nodeLoc.end.line, column: nodeLoc.end.column },
      };
    };

    const addSymbol = (name: string, type: SymbolNode['type'], loc: any, isExported: boolean = false) => {
      const id = `${filePath}#${name}`;
      symbols.set(id, {
        id,
        name,
        type,
        filePath,
        loc: getLoc(loc),
        isExported,
      });
    };

    traverse(ast, {
      ImportDeclaration(path) {
        if (t.isStringLiteral(path.node.source)) {
          imports.push(path.node.source.value);
        }
      },
      ExportNamedDeclaration(path) {
        if (path.node.declaration) {
          if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
            addSymbol(path.node.declaration.id.name, 'function', path.node.declaration.loc, true);
            exports.push(path.node.declaration.id.name);
          } else if (t.isVariableDeclaration(path.node.declaration)) {
            path.node.declaration.declarations.forEach((decl) => {
              if (t.isIdentifier(decl.id)) {
                addSymbol(decl.id.name, 'variable', decl.loc, true);
                exports.push(decl.id.name);
              }
            });
          } else if (t.isClassDeclaration(path.node.declaration) && path.node.declaration.id) {
            addSymbol(path.node.declaration.id.name, 'class', path.node.declaration.loc, true);
            exports.push(path.node.declaration.id.name);
          }
        }
        path.node.specifiers.forEach((specifier) => {
          if (t.isExportSpecifier(specifier) && t.isIdentifier(specifier.exported)) {
            exports.push(specifier.exported.name);
          }
        });
      },
      ExportDefaultDeclaration(path) {
        exports.push('default');
        addSymbol('default', 'export', path.node.loc, true);
      },
      FunctionDeclaration(path) {
        // Handled in export if exported, but capture local functions too
        if (path.node.id && !exports.includes(path.node.id.name)) {
          addSymbol(path.node.id.name, 'function', path.node.loc, false);
        }
      },
      VariableDeclarator(path) {
        if (t.isIdentifier(path.node.id) && !exports.includes(path.node.id.name)) {
          addSymbol(path.node.id.name, 'variable', path.node.loc, false);
        }
      },
      ClassDeclaration(path) {
        if (path.node.id && !exports.includes(path.node.id.name)) {
          addSymbol(path.node.id.name, 'class', path.node.loc, false);
        }
      }
    });

    return {
      filePath,
      symbols,
      imports,
      exports,
    };
  }
}
