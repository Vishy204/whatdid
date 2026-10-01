// Run with cwd = commander.js checkout. Passes when typo suggestions work again.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { suggestSimilar } = await import(pathToFileURL(path.resolve('lib/suggestSimilar.js')).href);
const ok = suggestSimilar('--hepl', ['--help', '--version']).includes('--help')
  && suggestSimilar('--verison', ['--help', '--version']).includes('--version')
  && suggestSimilar('--zzzzzz', ['--help']) === '';
process.exit(ok ? 0 : 1);
