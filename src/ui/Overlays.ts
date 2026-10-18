/** Start screen, pause menu, story screens and the quest HUD. Plain DOM; styling lives in styles.css. */

import { FINALE, LETTER, TITLE, type JournalLine } from '../quest/story';

const CONTROLS: ReadonlyArray<[string, string]> = [
  ['W A S D / Arrows', 'Move'],
  ['Shift', 'Run'],
  ['Space', 'Jump'],
  ['Drag mouse', 'Look around'],
  ['Mouse wheel', 'Zoom'],
  ['J', 'Map'],
  ['R', 'Back to the beach'],
  ['M', 'Sound on / off'],
  ['Esc', 'Pause'],
];

function controlsList(): HTMLElement {
  const dl = document.createElement('dl');
  dl.className = 'controls';
  for (const [key, action] of CONTROLS) {
    const dt = document.createElement('dt');
    for (const part of key.split(' / ')) {
      const kbd = document.createElement('kbd');
      kbd.textContent = part;
      dt.appendChild(kbd);
    }
    const dd = document.createElement('dd');
    dd.textContent = action;
    dl.append(dt, dd);
  }
  return dl;
}

export class StartScreen {
  readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(parent: HTMLElement, onPlay: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'overlay start-screen';
    this.el.innerHTML = `
      <div class="panel">
        <p class="eyebrow">${TITLE.eyebrow}</p>
        <h1>Tiny Island Explorer</h1>
        <p class="subtitle">${TITLE.subtitle}</p>
        <button class="play" type="button" disabled>Loading island…</button>
      </div>`;
    this.el.querySelector('.panel')!.appendChild(controlsList());
    this.button = this.el.querySelector('button.play')!;
    this.button.addEventListener('click', () => {
      this.button.blur();
      onPlay();
    });
    parent.appendChild(this.el);
  }

  setReady(): void {
    this.button.disabled = false;
    this.button.textContent = 'Play';
    this.button.focus();
  }

  setError(message: string): void {
    this.button.textContent = 'Could not start';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = message;
    this.el.querySelector('.panel')!.appendChild(p);
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}

export class PauseMenu {
  readonly el: HTMLElement;

  constructor(parent: HTMLElement, onResume: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'overlay pause-menu hidden';
    this.el.innerHTML = `
      <div class="panel compact">
        <h2>Paused</h2>
        <button class="resume" type="button">Resume</button>
      </div>`;
    this.el.querySelector('.panel')!.appendChild(controlsList());
    const button = this.el.querySelector<HTMLButtonElement>('button.resume')!;
    button.addEventListener('click', () => {
      button.blur();
      onResume();
    });
    parent.appendChild(this.el);
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible);
  }
}

/** Small corner hint shown while playing; fades after a few seconds. */
export class Hint {
  readonly el: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hint hidden';
    this.el.textContent = 'J for the map · Esc to pause · R to return to the beach · M for sound';
    parent.appendChild(this.el);
  }

  flash(): void {
    this.el.classList.remove('hidden');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.add('hidden'), 6000);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el.classList.add('hidden');
  }
}

const SPEAKER = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>`;

/** Sound on/off button (bottom-right). */
export class SoundToggle {
  readonly el: HTMLButtonElement;

  constructor(parent: HTMLElement, onToggle: () => void) {
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.className = 'sound-toggle';
    this.el.addEventListener('click', () => {
      this.el.blur();
      onToggle();
    });
    parent.appendChild(this.el);
  }

  setMuted(muted: boolean): void {
    this.el.innerHTML = muted
      ? `${SPEAKER}<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
      : `${SPEAKER}<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    this.el.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    this.el.title = muted ? 'Sound off (M)' : 'Sound on (M)';
  }
}

/** Quest progress card (top-left: lens dots, checklist, map button) and short centred messages. */
export class QuestHud {
  readonly el: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly label: HTMLElement;
  private readonly journal: HTMLUListElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;

  constructor(parent: HTMLElement, total: number, onMap: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'quest-hud hidden';
    this.el.setAttribute('aria-live', 'polite');
    const head = document.createElement('div');
    head.className = 'quest-head';
    const dots = document.createElement('div');
    dots.className = 'quest-dots';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('span');
      d.className = 'quest-dot';
      dots.appendChild(d);
      this.dots.push(d);
    }
    this.label = document.createElement('span');
    this.label.className = 'quest-label';
    const map = document.createElement('button');
    map.type = 'button';
    map.className = 'map-button';
    map.textContent = 'Map (J)';
    map.addEventListener('click', () => {
      map.blur();
      onMap();
    });
    head.append(dots, this.label, map);
    this.journal = document.createElement('ul');
    this.journal.className = 'quest-journal';
    this.el.append(head, this.journal);
    parent.appendChild(this.el);

    this.toast = document.createElement('div');
    this.toast.className = 'quest-toast hidden';
    parent.appendChild(this.toast);
    this.setProgress(0, total);
  }

  show(): void {
    this.el.classList.remove('hidden');
  }

  setProgress(collected: number, total: number): void {
    this.dots.forEach((d, i) => d.classList.toggle('found', i < collected));
    this.label.textContent = collected >= total ? 'Lens restored — to the lighthouse door!' : `Lens pieces ${collected} / ${total}`;
  }

  setDone(): void {
    this.label.textContent = 'The lighthouse is lit';
  }

  /** The to-do list under the counter; finished tasks stay, ticked off. */
  setJournal(lines: JournalLine[]): void {
    this.journal.replaceChildren(
      ...lines.map((line) => {
        const li = document.createElement('li');
        li.textContent = line.text;
        if (line.done) li.className = 'done';
        return li;
      }),
    );
  }

  message(text: string, ms = 3600): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add('hidden'), ms);
  }
}

/** The letter from the message in a bottle. */
export class LetterScreen {
  readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(parent: HTMLElement, onContinue: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'overlay letter hidden';
    const panel = document.createElement('div');
    panel.className = 'panel paper';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = LETTER.eyebrow;
    const title = document.createElement('h2');
    title.textContent = LETTER.title;
    panel.append(eyebrow, title);
    for (const text of LETTER.paragraphs) {
      const p = document.createElement('p');
      p.textContent = text;
      panel.appendChild(p);
    }
    const sign = document.createElement('p');
    sign.className = 'signature';
    sign.textContent = LETTER.signature;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'continue';
    this.button.textContent = LETTER.button;
    this.button.addEventListener('click', () => {
      this.button.blur();
      onContinue();
    });
    panel.append(sign, this.button);
    this.el.appendChild(panel);
    parent.appendChild(this.el);
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible);
    if (visible) this.button.focus();
  }
}

export class FinaleScreen {
  readonly el: HTMLElement;

  constructor(parent: HTMLElement, onContinue: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'overlay finale hidden';
    this.el.innerHTML = `
      <div class="panel">
        <p class="eyebrow">${FINALE.eyebrow}</p>
        <h1>${FINALE.title}</h1>
        <p class="subtitle">${FINALE.subtitle}</p>
        <button class="continue" type="button">${FINALE.button}</button>
      </div>`;
    const button = this.el.querySelector<HTMLButtonElement>('button.continue')!;
    button.addEventListener('click', () => {
      button.blur();
      onContinue();
    });
    parent.appendChild(this.el);
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible);
    if (visible) this.el.querySelector<HTMLButtonElement>('button.continue')!.focus();
  }
}
