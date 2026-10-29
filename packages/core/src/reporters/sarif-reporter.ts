import { AnalysisReport, DeadCodeFinding } from '../types';

export class JsonReporter {
  public generate(report: AnalysisReport): string {
    return JSON.stringify(report, null, 2);
  }
}

export class SarifReporter {
  public generate(report: AnalysisReport): string {
    const sarif = {
      version: "2.1.0",
      $schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "AI Code Debt Analyzer",
              informationUri: "https://github.com/ai-code-debt",
              rules: [
                {
                  id: "UNUSED_EXPORT",
                  name: "UnusedExport",
                  shortDescription: {
                    text: "Exported symbol is never imported."
                  }
                },
                // ... other rules
              ]
            }
          },
          results: report.findings.map(finding => this.mapFindingToResult(finding))
        }
      ]
    };

    return JSON.stringify(sarif, null, 2);
  }

  private mapFindingToResult(finding: DeadCodeFinding) {
    return {
      ruleId: finding.category,
      message: {
        text: `Dead code found: ${finding.symbol?.name || 'Unknown'} (${finding.category})`
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: finding.filePath
            },
            region: finding.loc ? {
              startLine: finding.loc.start.line,
              startColumn: finding.loc.start.column,
              endLine: finding.loc.end.line,
              endColumn: finding.loc.end.column
            } : undefined
          }
        }
      ]
    };
  }
}
