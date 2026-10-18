// Every word the player reads during the lighthouse quest, in one place so the story can be
// edited without touching game code. Written for young readers: short sentences, plain words.

import type { QuestView } from './Quest';

export const TITLE = {
  eyebrow: 'A small island adventure',
  subtitle:
    'Last night a big storm broke the lighthouse lamp. Tonight the fishing boats need its light to find their way home. Can you help?',
};

/** The message in the bottle on the spawn beach. */
export const LETTER = {
  eyebrow: 'A message in a bottle',
  title: 'Dear Explorer,',
  paragraphs: [
    'The storm smashed the glass lens of my lighthouse into five pieces, and the wind blew them all over the island!',
    'I am stuck on the big island across the sea, so I need your help. The fishing boats come home tonight, and without the light they will get lost.',
    'I hid some clues for you: look for my wooden signs. I also drew you a map. Press J to look at it any time.',
  ],
  signature: 'Thank you, brave explorer! Captain Wren, the lighthouse keeper',
  button: 'Show me the map',
};

export const MAP = {
  title: "Captain Wren's map",
  close: 'Back to exploring',
  you: 'You',
};

/** Signs and notes the player walks up to. */
export const NOTES = {
  bells:
    "Wren's sign: The Singing Bells. Stand on the stone with the music note to hear their song. Then step on the coloured stones to sing it back!",
  chest: "Wren's sign: My treasure chest! The lock has five shell-shaped holes. Find five golden shells on the beaches.",
  stones: "Wren's sign: Jump from stone to stone. If you splash into the sea, just try again!",
  crates: "Wren's note: Those crates make good stairs. Can you jump up onto the hut roof?",
} as const;
export type NoteId = keyof typeof NOTES;

export const TOASTS = {
  start: 'Something shiny is lying in the sand. Go and take a look!',
  startAfterBottle: 'Find the five lost pieces of the lighthouse lens. Press J for the map.',
  pieceFound: (left: number) => `Lens piece found! ${left} to go.`,
  lensWhole: 'The lens is whole again! Bring it to the lighthouse door.',
  hint: 'A beam of light rises somewhere on the island…',
  doorLocked: (missing: number) =>
    `The lens frame by the door is empty. ${missing} piece${missing === 1 ? '' : 's'} still missing.`,
  finaleStart: 'The lighthouse flickers to life…',
  bellRight: 'Ding! That is the right bell.',
  bellWrong: 'Oops, that is not the song. Listen again on the music stone.',
  songPlaying: 'Listen to the bells…',
  bellsSolved: 'The bells sang their song! A lens piece is shining on top of the old ruin. Jump up!',
  shell: (found: number, total: number) =>
    found < total ? `Golden shell! ${found} / ${total}` : `Golden shell! That's all ${total}. Go to Wren's chest!`,
  chestOpen: "Click! Wren's chest swings open and a lens piece floats out!",
  dig: 'You dug where the X was… treasure! A lens piece!',
};

export const FINALE = {
  eyebrow: 'Quest complete',
  title: 'The light is back',
  subtitle:
    'The lighthouse shines again, and the fishing boats follow its light safely home. Captain Wren will be so proud of you! The island is yours to explore.',
  button: 'Keep exploring',
};

export interface JournalLine {
  text: string;
  done: boolean;
}

/** The checklist in the corner: one line per lens piece, then the final task. */
export function journalLines(q: QuestView): JournalLine[] {
  if (!q.bottleRead) return [{ text: 'Look at the shiny thing on the beach', done: false }];
  const piece = (id: string) => q.pieces.find((p) => p.id === id);
  const lines: JournalLine[] = [];
  const ruin = piece('ruin');
  if (ruin) {
    const text = ruin.collected
      ? 'The singing bells'
      : q.bellsSolved
        ? 'Jump up onto the old ruin'
        : 'Play the song on the singing bells';
    lines.push({ text, done: ruin.collected });
  }
  const woods = piece('woods');
  if (woods) {
    const text = woods.collected
      ? "Wren's treasure chest"
      : q.chestOpen
        ? "Take the piece from Wren's chest"
        : `Find golden shells for the chest (${q.shellsFound} / ${q.shellsTotal})`;
    lines.push({ text, done: woods.collected });
  }
  const cliff = piece('cliff');
  if (cliff) lines.push({ text: cliff.collected ? 'X marks the spot' : 'Find the X from the map', done: cliff.collected });
  const islet = piece('islet');
  if (islet) lines.push({ text: 'Hop out to the sea rock', done: islet.collected });
  const roof = piece('roof');
  if (roof) lines.push({ text: "Climb onto the keeper's hut roof", done: roof.collected });
  if (q.state !== 'collecting') lines.push({ text: 'Bring the lens to the lighthouse door', done: q.state === 'done' });
  return lines;
}
