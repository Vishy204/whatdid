import { formatDate } from './core/util.js';
import { Engine } from './engine';

export async function main(argv: string[]): Promise<void> {
  new Engine().start();
  console.log(formatDate(new Date()));
}
