export interface Options {
  verbose: boolean;
}

export const VERSION = '1.0.0';

export function formatDate(d: Date, opts?: Options): string {
  return d.toISOString();
}

function internalHelper() {}
