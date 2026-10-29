import { ASTParser } from '../src/parser/ast-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('ASTParser', () => {
  let parser: ASTParser;
  let tempDir: string;

  beforeEach(() => {
    parser = new ASTParser();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-parser-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should extract exported functions and variables', () => {
    const filePath = path.join(tempDir, 'test1.ts');
    fs.writeFileSync(filePath, `
      export function hello() {}
      export const world = "world";
      function localFunc() {}
    `);

    const result = parser.parseFile(filePath);
    
    expect(result.exports).toContain('hello');
    expect(result.exports).toContain('world');
    expect(result.exports).not.toContain('localFunc');
    
    const helloSymbol = result.symbols.get(`${filePath}#hello`);
    expect(helloSymbol).toBeDefined();
    expect(helloSymbol?.type).toBe('function');
    expect(helloSymbol?.isExported).toBe(true);

    const localFuncSymbol = result.symbols.get(`${filePath}#localFunc`);
    expect(localFuncSymbol).toBeDefined();
    expect(localFuncSymbol?.isExported).toBe(false);
  });
});
