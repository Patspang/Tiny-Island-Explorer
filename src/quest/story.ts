// Every word the player reads, in one place so the story can be edited without touching game
// code. The game is in Dutch, written for young readers: short sentences, plain words.

import type { QuestView } from './Quest';

export const TITLE = {
  name: 'Klein Eiland Ontdekker',
  eyebrow: 'Een avontuur op een klein eiland',
  subtitle:
    'Vannacht heeft een grote storm de lamp van de vuurtoren kapotgemaakt. Vanavond hebben de vissersboten het licht nodig om de weg naar huis te vinden. Help jij mee?',
};

/** The message in the bottle on the spawn beach. */
export const LETTER = {
  eyebrow: 'Een briefje in een fles',
  title: 'Beste ontdekker,',
  // Short sentences, few words: the child reads this before the game really starts.
  paragraphs: [
    'Ik ben Kapitein Zwartbaard, de vuurtorenwachter.',
    'De storm heeft de lens van mijn vuurtoren in vijf stukken gebroken. De wind heeft ze over het hele eiland geblazen.',
    'Vanavond komen de vissersboten thuis. Zij hebben het licht nodig! Wil jij de vijf stukken zoeken? Ik heb een kaart voor je getekend.',
  ],
  /** Added to the last paragraph: how to open the map on this device. */
  mapHint: 'Druk op K om hem te bekijken.',
  mapHintTouch: 'Tik op de knop Kaart om hem te bekijken.',
  signature: 'Dank je wel! Kapitein Zwartbaard',
  button: 'Laat de kaart zien',
};

export const MAP = {
  title: 'De kaart van Kapitein Zwartbaard',
  close: 'Verder ontdekken',
  you: 'Jij',
  north: 'N',
  labels: {
    lighthouse: 'Vuurtoren',
    bells: 'Klokken',
    chest: 'Schatkist',
    ruin: 'Ruïne',
    stones: 'Zeerots',
    hut: 'Hutje',
  },
};

/** Signs and notes the player walks up to. */
export const NOTES = {
  bells:
    'Bordje van Zwartbaard: De Zingende Klokken. Ga op de steen met de muzieknoot staan en luister naar hun liedje. Zing het daarna terug door op de gekleurde stenen te stappen!',
} as const;
export type NoteId = keyof typeof NOTES;

export const TOASTS = {
  start: 'Er ligt iets glimmends in het zand. Ga eens kijken!',
  startAfterBottle: 'Zoek de vijf verloren stukken van de vuurtorenlens. Druk op K voor de kaart.',
  pieceFound: (left: number) => `Lensstuk gevonden! Nog ${left} te gaan.`,
  lensWhole: 'De lens is weer heel! Breng hem naar de deur van de vuurtoren.',
  hint: 'Ergens op het eiland schijnt een straal licht omhoog…',
  doorLocked: (missing: number) =>
    `Het lijstje naast de deur is nog leeg. Er ${missing === 1 ? 'mist nog 1 stuk' : `missen nog ${missing} stukken`}.`,
  finaleStart: 'De vuurtoren begint te flikkeren…',
  bellRight: 'Ding! Dat is de goede klok.',
  bellWrong: 'Oeps, zo gaat het liedje niet. Luister nog eens op de steen met de muzieknoot.',
  songPlaying: 'Luister goed naar de klokken…',
  bellsSolved: 'De klokken hebben hun liedje gezongen! Boven op de oude ruïne glinstert een lensstuk. Spring maar omhoog!',
  shell: (found: number, total: number) =>
    found < total ? `Gouden schelp! ${found} / ${total}` : `Gouden schelp! Je hebt ze alle ${total}. Ga naar de schatkist van Zwartbaard!`,
  chestOpen: 'Klik! De schatkist van Zwartbaard gaat open en er zweeft een lensstuk uit!',
  dig: 'Je hebt gegraven waar het kruis was… een schat! Een lensstuk!',
};

export const FINALE = {
  eyebrow: 'Opdracht voltooid',
  title: 'Het licht is terug',
  subtitle:
    'De vuurtoren schijnt weer en de vissersboten volgen het licht veilig naar huis. Kapitein Zwartbaard is heel trots op je! Het eiland is helemaal van jou om te ontdekken.',
  button: 'Verder ontdekken',
};

/** Menus, buttons and the small labels around the game. */
export const UI = {
  loading: 'Eiland wordt geladen…',
  play: 'Spelen',
  /** Play button when there is saved progress, and the button that throws it away. */
  continuePlay: 'Verder spelen',
  newGame: 'Opnieuw beginnen',
  startFailed: 'Starten lukte niet',
  paused: 'Pauze',
  resume: 'Verder spelen',
  // Just the two keys a child needs while playing; the rest is on the start screen and in the pause menu.
  cornerHint: 'K voor de kaart · Esc voor pauze',
  cornerHintTouch: 'Linkerduim: lopen · Pijl-knop: springen · Veeg over het scherm: rondkijken',
  backToBeach: 'Terug naar het strand',
  jump: 'Springen',
  pause: 'Pauze',
  rotate: 'Draai je scherm voor een groter eiland',
  soundOn: 'Geluid aan (M)',
  soundOff: 'Geluid uit (M)',
  turnSoundOn: 'Geluid aanzetten',
  turnSoundOff: 'Geluid uitzetten',
  mapButton: 'Kaart (K)',
  mapButtonTouch: 'Kaart',
  lensCount: (collected: number, total: number) => `Lensstukken ${collected} / ${total}`,
  lensRestored: 'Lens compleet — naar de deur van de vuurtoren!',
  lighthouseLit: 'De vuurtoren brandt weer',
  controls: [
    ['W A S D / Pijltjes', 'Lopen'],
    ['Shift', 'Rennen'],
    ['Spatie', 'Springen'],
    ['Muis slepen', 'Rondkijken'],
    ['Muiswiel', 'In- en uitzoomen'],
    ['K', 'Kaart'],
    ['R', 'Terug naar het strand'],
    ['M', 'Geluid aan / uit'],
    ['Esc', 'Pauze'],
  ] as ReadonlyArray<[string, string]>,
  /** Shown instead of the keys on phones and tablets. */
  touchControls: [
    ['Linkerduim', 'Lopen (helemaal duwen = rennen)'],
    ['Pijl-knop', 'Springen'],
    ['Vegen', 'Rondkijken'],
    ['Twee vingers', 'In- en uitzoomen'],
    ['Kaart-knop', 'Kaart'],
    ['Pauze-knop', 'Pauze, of terug naar het strand'],
  ] as ReadonlyArray<[string, string]>,
};

export interface JournalLine {
  text: string;
  done: boolean;
}

/** The goal in the corner: just what to do next, not where everything is. */
export function journalLines(q: QuestView): JournalLine[] {
  if (!q.bottleRead) return [{ text: 'Bekijk het glimmende ding op het strand', done: false }];
  const allFound = q.state !== 'collecting';
  const lines: JournalLine[] = [{ text: 'Zoek de vijf lensstukken van de vuurtoren', done: allFound }];
  if (allFound) {
    lines.push({ text: 'Breng de lens naar de deur van de vuurtoren', done: q.state === 'done' });
    return lines;
  }
  if (q.shellsTotal > 0) {
    const shellsDone = q.shellsFound === q.shellsTotal;
    lines.push({ text: `Zoek de vijf gouden schelpen (${q.shellsFound} / ${q.shellsTotal})`, done: shellsDone });
    if (shellsDone) lines.push({ text: 'Breng de schelpen naar de schatkist', done: q.chestOpen });
  }
  return lines;
}
