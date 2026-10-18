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
  paragraphs: [
    'De storm heeft de glazen lens van mijn vuurtoren in vijf stukken gebroken. De wind heeft ze over het hele eiland geblazen!',
    'Ik zit vast op het grote eiland aan de overkant van de zee. Daarom heb ik jouw hulp nodig. Vanavond komen de vissersboten thuis. Zonder licht raken ze de weg kwijt.',
    'Ik heb aanwijzingen voor je achtergelaten: kijk goed naar mijn houten bordjes. Ik heb ook een kaart voor je getekend. Druk op K om hem te bekijken.',
  ],
  signature: 'Dank je wel, dappere ontdekker! Kapitein Zwartbaard, de vuurtorenwachter',
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
  chest: 'Bordje van Zwartbaard: Mijn schatkist! Het slot heeft vijf gaatjes in de vorm van een schelp. Zoek vijf gouden schelpen op de stranden.',
  stones: 'Bordje van Zwartbaard: Spring van steen naar steen. Plons je in de zee? Geen probleem, probeer het gewoon nog een keer!',
  crates: 'Briefje van Zwartbaard: Met die kisten kun je mooi omhoog klimmen. Lukt het jou om op het dak van het hutje te springen?',
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
  startFailed: 'Starten lukte niet',
  paused: 'Pauze',
  resume: 'Verder spelen',
  cornerHint: 'K voor de kaart · Esc voor pauze · R terug naar het strand · M voor geluid',
  soundOn: 'Geluid aan (M)',
  soundOff: 'Geluid uit (M)',
  turnSoundOn: 'Geluid aanzetten',
  turnSoundOff: 'Geluid uitzetten',
  mapButton: 'Kaart (K)',
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
};

export interface JournalLine {
  text: string;
  done: boolean;
}

/** The checklist in the corner: one line per lens piece, then the final task. */
export function journalLines(q: QuestView): JournalLine[] {
  if (!q.bottleRead) return [{ text: 'Bekijk het glimmende ding op het strand', done: false }];
  const piece = (id: string) => q.pieces.find((p) => p.id === id);
  const lines: JournalLine[] = [];
  const ruin = piece('ruin');
  if (ruin) {
    const text = ruin.collected
      ? 'De zingende klokken'
      : q.bellsSolved
        ? 'Spring op de oude ruïne'
        : 'Speel het liedje op de zingende klokken';
    lines.push({ text, done: ruin.collected });
  }
  const woods = piece('woods');
  if (woods) {
    const text = woods.collected
      ? 'De schatkist van Zwartbaard'
      : q.chestOpen
        ? 'Pak het lensstuk uit de schatkist'
        : `Zoek gouden schelpen voor de kist (${q.shellsFound} / ${q.shellsTotal})`;
    lines.push({ text, done: woods.collected });
  }
  const cliff = piece('cliff');
  if (cliff) lines.push({ text: cliff.collected ? 'Het kruis op de kaart' : 'Zoek het kruis van de kaart', done: cliff.collected });
  const islet = piece('islet');
  if (islet) lines.push({ text: 'Spring naar de rots in zee', done: islet.collected });
  const roof = piece('roof');
  if (roof) lines.push({ text: 'Klim op het dak van het hutje', done: roof.collected });
  if (q.state !== 'collecting') lines.push({ text: 'Breng de lens naar de deur van de vuurtoren', done: q.state === 'done' });
  return lines;
}
