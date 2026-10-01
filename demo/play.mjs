#!/usr/bin/env node
// Deterministic whatdid demo: no Claude Code, no API calls, same output every time.
//
//   node demo/play.mjs              # print what "??" shows for the demo session
//   node demo/play.mjs replay       # any "??" words work: all, 2, replay, --ascii
//   node demo/play.mjs --prompt     # fake prompt: type wd (or "wd replay"), Enter; "exit" quits. Used by demo.tape
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Copy the fixtures into a throwaway WHATDID_HOME so the demo never touches real session logs.
export function stage() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whatdid-demo-'));
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  const transcript = path.join(home, 'transcript.jsonl');
  fs.copyFileSync(path.join(HERE, 'fixture-transcript.jsonl'), transcript);
  const events = fs.readFileSync(path.join(HERE, 'fixture-session.jsonl'), 'utf8')
    .replaceAll('"__TRANSCRIPT__"', JSON.stringify(transcript));
  const file = path.join(home, 'sessions', 'demo-session.jsonl');
  fs.writeFileSync(file, events);
  return { home, file, transcript };
}

export async function show(words, { file, transcript }) {
  const { readEvents } = await import('../scripts/lib.mjs');
  const { render, parseArgs } = await import('../scripts/render.mjs');
  const opts = parseArgs(words);
  const width = Math.min(process.stdout.columns || 100, 100);
  return render(readEvents(file), { ...opts, transcript, width });
}

async function main() {
  const args = process.argv.slice(2);
  const staged = stage();
  process.env.WHATDID_HOME = staged.home;
  try {
    if (!args.includes('--prompt')) {
      console.log(await show(args, staged));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '\x1b[1m>\x1b[0m ' });
    console.log('\x1b[2mClaude Code session (demo) · whatdid enabled · type wd to see what Claude did\x1b[0m\n');
    rl.prompt();
    for await (const line of rl) {
      const m = line.trim().match(/^\?\?\s*(.*)$/);
      if (/^(exit|quit)$/i.test(line.trim())) break;
      const base = args.filter((a) => a !== '--prompt');
      if (m) console.log('\n' + (await show([...base, ...m[1].split(/\s+/).filter(Boolean)], staged)) + '\n');
      else if (line.trim()) console.log('\x1b[2m(demo only understands wd commands)\x1b[0m');
      rl.prompt();
    }
    rl.close();
  } finally {
    fs.rmSync(staged.home, { recursive: true, force: true });
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) await main();
