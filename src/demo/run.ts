/**
 * CLI entry point: `npm run demo`.
 * Prints each step as it happens so the run can be narrated live.
 */
import { RainApiError } from '../lib/errors.js';
import { runDemo, type StepResult } from './flow.js';

const MARK: Record<StepResult['status'], string> = {
  ok: '  ok  ',
  failed: 'FAIL  ',
  skipped: ' --   ',
};

function print(result: StepResult): void {
  const line = `${MARK[result.status]}${result.step}`;
  if (result.status === 'failed') {
    console.error(`\n${line}\n      ${result.detail}\n`);
  } else if (result.status === 'skipped') {
    console.log(`${line}${result.detail ? ` (${result.detail})` : ''}`);
  } else {
    console.log(line);
    if (result.data !== undefined) {
      const rendered = JSON.stringify(result.data);
      console.log(`      ${rendered.length > 300 ? `${rendered.slice(0, 300)}...` : rendered}`);
    }
  }
}

const fundingArg = process.argv.find((a) => a.startsWith('--funding='));
const reuseArg = process.argv.find((a) => a.startsWith('--company='));

console.log('\nRain corporate card program - sandbox end-to-end run');
console.log('====================================================\n');

try {
  const summary = await runDemo({
    fundingAmount: fundingArg ? Number(fundingArg.split('=')[1]) : undefined,
    reuseCompanyId: reuseArg ? reuseArg.split('=')[1] : undefined,
    onStep: print,
  });

  console.log('\n----------------------------------------------------');
  console.log(`company      ${summary.companyId ?? '-'}`);
  console.log(`contract     ${summary.contractId ?? '-'}`);
  console.log(`cardholders  ${summary.userIds.length}`);
  console.log(`cards        ${summary.cardIds.length}`);
  if (summary.balances) console.log(`balances     ${JSON.stringify(summary.balances)}`);

  if (summary.failed) {
    console.error('\nRun did not complete. See the FAIL line above.\n');
    process.exit(1);
  }
  console.log('\nRun complete.\n');
} catch (err) {
  if (err instanceof RainApiError) {
    console.error(`\nRain API error: ${err.message}`);
    console.error(JSON.stringify(err.body, null, 2));
  } else {
    console.error(`\n${err instanceof Error ? err.stack : String(err)}`);
  }
  process.exit(1);
}
