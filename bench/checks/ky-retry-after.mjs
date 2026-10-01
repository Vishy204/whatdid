// Run with cwd = ky checkout. Passes when Retry-After seconds become milliseconds again.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const file = path.resolve('source/core/retry-timing.ts');
let ok;
try {
  const m = await import(pathToFileURL(file).href);
  ok = m.calculateRetryTimingDelay({ value: '5', allowTimestamp: false }) === 5000
    && m.calculateRetryTimingDelay({ value: '0', allowTimestamp: false }) === 0;
} catch {
  // Node < 22.18 can't strip TypeScript types; fall back to a source check.
  ok = /Number\(value\)\s*\*\s*1000/.test(fs.readFileSync(file, 'utf8'));
}
process.exit(ok ? 0 : 1);
