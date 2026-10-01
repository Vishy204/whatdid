// Prints the real whatdid output for turn 1 of the demo session as JSON, for the GIF renderer.
import { stage } from '../../demo/play.mjs';
import { readEvents } from '../../scripts/lib.mjs';
import { renderTurn, renderReplay, renderCard, splitTurns } from '../../scripts/render.mjs';

const { file, transcript } = stage();
const events = readEvents(file);
const secondPrompt = events.filter((e) => e.ev === 'prompt')[1];
const turn1 = secondPrompt ? events.filter((e) => e.t < secondPrompt.t) : events;
const turns = splitTurns(turn1).filter((t) => t.prompt || t.tools.length);
const width = Number(process.argv[2] || 88);
console.log(JSON.stringify({
  prompt: turns[0].prompt,
  map: renderTurn(turns[0], 0, 1, { transcript, width, cwd: null }),
  replay: renderReplay(turns[0], 0, 1, { transcript, width }),
  card: renderCard(turn1, { transcript }),
}));
