import { formatDate, type Options } from './core/util';

export class Engine extends Base {
  private secret() {}
  start() {
    formatDate(new Date());
  }
  async stop(force: boolean) {}
}

export const createEngine = (opts: Options) => new Engine();
