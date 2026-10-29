import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeProject, JsonReporter, SarifReporter } from '@ai-code-debt/core';

const program = new Command();

program
  .name('ai-code-debt')
  .description('CLI to analyze code debt and detect dead code using static analysis and AI')
  .version('1.0.0');

program
  .command('scan')
  .description('Scan a project for dead code')
  .requiredOption('-e, --entry <paths...>', 'Entry point files or directories to start reachability analysis (e.g. src/index.ts)')
  .option('-x, --exclude <patterns...>', 'Glob patterns to exclude')
  .option('-f, --format <format>', 'Output format (text, json, sarif)', 'text')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .option('--ai-verify', 'Use AI to verify dead code findings (requires API key setup)')
  .action(async (options) => {
    const spinner = ora('Initializing codebase analysis...').start();
    
    try {
      const startTime = Date.now();
      
      spinner.text = 'Building dependency and call graphs...';
      const report = await analyzeProject({
        entryPoints: options.entry,
        excludePatterns: options.exclude || [],
        enableAiVerification: options.aiVerify || false,
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      spinner.succeed(`Analysis complete in ${duration}s. Scanned ${report.filesScanned} files.`);

      let outputStr = '';

      if (options.format === 'json') {
        const reporter = new JsonReporter();
        outputStr = reporter.generate(report);
      } else if (options.format === 'sarif') {
        const reporter = new SarifReporter();
        outputStr = reporter.generate(report);
      } else {
        // Text format
        if (report.totalFindings === 0) {
          outputStr = chalk.green('🎉 No dead code found! Your codebase is pristine.');
        } else {
          outputStr += chalk.yellow(`Found ${report.totalFindings} potential dead code items:\n\n`);
          report.findings.forEach((finding, index) => {
            outputStr += chalk.bold.red(`[${index + 1}] ${finding.category}\n`);
            if (finding.symbol) {
              outputStr += `  Symbol: ${chalk.cyan(finding.symbol.name)} (${finding.symbol.type})\n`;
            }
            outputStr += `  File: ${chalk.gray(finding.filePath)}\n`;
            if (finding.loc) {
              outputStr += `  Line: ${finding.loc.start.line}\n`;
            }
            if (finding.confidence) {
              const score = (finding.confidence.score * 100).toFixed(0);
              outputStr += `  AI Confidence: ${chalk.green(`${score}%`)}\n`;
              outputStr += `  AI Reasoning: ${chalk.italic(finding.confidence.reasoning)}\n`;
            }
            outputStr += '\n';
          });
        }
      }

      if (options.output) {
        const outputPath = path.resolve(process.cwd(), options.output);
        fs.writeFileSync(outputPath, outputStr, 'utf-8');
        console.log(chalk.green(`\nReport saved to ${outputPath}`));
      } else {
        console.log('\n' + outputStr);
      }

    } catch (error: any) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Fetch and display the full Stage 5 report for a scan run')
  .requiredOption('-i, --id <scanRunId>', 'The ID of the scan run')
  .option('-u, --url <url>', 'API Base URL', 'http://localhost:3001')
  .action(async (options) => {
    const spinner = ora('Fetching report...').start();
    try {
      const response = await fetch(`${options.url}/v1/repositories/${options.id}/report.json`);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      spinner.succeed('Report fetched successfully.');
      
      console.log(chalk.cyan.bold('\n--- Stage 5 Report ---'));
      console.log(chalk.gray(`Repository: `) + chalk.white(data.repository));
      console.log(chalk.gray(`Generated at: `) + chalk.white(data.generated_at));
      
      console.log(chalk.cyan.bold('\n--- Summary ---'));
      console.log(`Total Candidates:   ${chalk.yellow(data.summary.total_candidates)}`);
      console.log(`High Confidence:    ${chalk.green(data.summary.high_confidence)}`);
      console.log(`Provenance Unclear: ${chalk.red(data.summary.provenance_unclear)}`);
      
      console.log(chalk.cyan.bold('\n--- Candidates ---'));
      console.log(JSON.stringify(data.candidates, null, 2));

    } catch (error: any) {
      spinner.fail('Failed to fetch report');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program
  .command('trigger')
  .description('Trigger the distributed async pipeline for a repository via the API')
  .requiredOption('-r, --repo <repository>', 'Repository name (e.g. owner/repo)')
  .requiredOption('-e, --entry <paths...>', 'Entry point files or directories (e.g. src/index.ts)')
  .option('-a, --all <paths...>', 'All files in the repository (needed for reachability RBU generation)')
  .option('-x, --exclude <patterns...>', 'Glob patterns to exclude')
  .option('-u, --url <url>', 'API Base URL', 'http://localhost:3001')
  .action(async (options) => {
    const spinner = ora('Triggering distributed pipeline...').start();
    try {
      const response = await fetch(`${options.url}/v1/scans/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repository: options.repo,
          entryPoints: options.entry,
          allFiles: options.all || [],
          excludePatterns: options.exclude || []
        })
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      spinner.succeed(`Pipeline triggered successfully!`);
      console.log(chalk.green(`Job ID: ${data.jobId}`));
      console.log(chalk.gray(`The pipeline is now running asynchronously. Use the 'report' command or check the dashboard to view results later.`));
    } catch (error: any) {
      spinner.fail('Failed to trigger pipeline');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

program.parse();
