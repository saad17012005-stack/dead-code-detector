import { Stage5Report } from '@ai-code-debt/core';

export async function createGitHubCheck(
  octokit: any,
  owner: string,
  repo: string,
  head_sha: string,
  report: Stage5Report
) {
  const summaryMarkdown = `
## Dead Code Detection Report

* **Total Candidates:** ${report.summary.total_candidates}
* **High Confidence:** ${report.summary.high_confidence}
* **Provenance Unclear:** ${report.summary.provenance_unclear}

View the full JSON report below or download the artifact.
  `;

  // Provide exact JSON schema as a code block for the check output
  const jsonReportStr = JSON.stringify(report, null, 2);

  await octokit.rest.checks.create({
    owner,
    repo,
    name: 'AI Code Debt / Dead Code',
    head_sha,
    status: 'completed',
    conclusion: report.summary.high_confidence > 0 ? 'action_required' : 'success',
    output: {
      title: 'Phase 3: Correlation & Reporting',
      summary: summaryMarkdown,
      text: "```json\n" + jsonReportStr + "\n```"
    }
  });
}
