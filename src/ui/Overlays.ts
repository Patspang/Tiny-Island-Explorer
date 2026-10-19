/** Start screen, pause menu, story screens and the quest HUD. Plain DOM; styling lives in styles.css. */

import { FINALE, LETTER, TITLE, UI, type JournalLine } from '../quest/story';
import { isTouchDevice } from './TouchControls';


function controlsList(): HTMLElement {
  const dl = document.createElement('dl');
  dl.className = 'controls';
  for (const [key, action] of isTouchDevice() ? UI.touchControls : UI.controls) {
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
        <h1>${TITLE.name}</h1>
        <p class="subtitle">${TITLE.subtitle}</p>
        <button class="play" type="button" disabled>${UI.loading}</button>
      </div>`;
    this.el.querySelector('.panel')!.appendChild(controlsList());
    this.button = this.el.querySelector('button.play')!;
    this.button.addEventListener('click', () => {
      this.button.blur();
      onPlay();
    });
    parent.appendChild(this.el);
  }

  /** `onNewGame` is given when there is saved progress: Play then continues it. */
  setReady(onNewGame?: () => void): void {
    this.button.disabled = false;
    this.button.textContent = onNewGame ? UI.continuePlay : UI.play;
    if (onNewGame) {
      const fresh = document.createElement('button');
      fresh.type = 'button';
      fresh.className = 'secondary new-game';
      fresh.textContent = UI.newGame;
      fresh.addEventListener('click', onNewGame);
      this.button.after(fresh);
    }
    this.button.focus();
  }

  setError(message: string): void {
    this.button.textContent = UI.startFailed;
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

  constructor(parent: HTMLElement, onResume: () => void, onBackToBeach: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'overlay pause-menu hidden';
    this.el.innerHTML = `
      <div class="panel compact">
        <h2>${UI.paused}</h2>
        <button class="resume" type="button">${UI.resume}</button>
        <button class="secondary back-to-beach" type="button">${UI.backToBeach}</button>
      </div>`;
    this.el.querySelector('.panel')!.appendChild(controlsList());
    const button = this.el.querySelector<HTMLButtonElement>('button.resume')!;
    button.addEventListener('click', () => {
      button.blur();
      onResume();
    });
    // Touch devices have no R key; useful on a keyboard too.
    const beach = this.el.querySelector<HTMLButtonElement>('button.back-to-beach')!;
    beach.addEventListener('click', () => {
      beach.blur();
      onBackToBeach();
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
    this.el.textContent = isTouchDevice() ? UI.cornerHintTouch : UI.cornerHint;
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
    this.el.setAttribute('aria-label', muted ? UI.turnSoundOn : UI.turnSoundOff);
    this.el.title = muted ? UI.soundOff : UI.soundOn;
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
    map.textContent = isTouchDevice() ? UI.mapButtonTouch : UI.mapButton;
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
    this.toast.addEventListener('click', () => this.toast.classList.add('hidden'));
    parent.appendChild(this.toast);
    this.setProgress(0, total);
  }

  show(): void {
    this.el.classList.remove('hidden');
  }

  setProgress(collected: number, total: number): void {
    this.dots.forEach((d, i) => d.classList.toggle('found', i < collected));
    this.label.textContent = collected >= total ? UI.lensRestored : UI.lensCount(collected, total);
  }

  setDone(): void {
    this.label.textContent = UI.lighthouseLit;
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
    this.placeToast();
  }

  /** Messages sit top-centre, but drop below the goal card wherever the two would overlap. */
  private placeToast(): void {
    this.toast.style.top = '';
    if (this.el.classList.contains('hidden')) return;
    const card = this.el.getBoundingClientRect();
    const toast = this.toast.getBoundingClientRect();
    if (toast.left < card.right + 8 && toast.top < card.bottom + 8) this.toast.style.top = `${card.bottom + 10}px`;
  }

  /** Show a message long enough for a young reader (about 90 words a minute); a tap closes it sooner. */
  message(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('hidden');
    this.placeToast();
    window.clearTimeout(this.toastTimer);
    const words = text.split(/\s+/).filter(Boolean).length;
    const ms = Math.max(3500, 1500 + words * 650);
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
    LETTER.paragraphs.forEach((text, i) => {
      const p = document.createElement('p');
      const last = i === LETTER.paragraphs.length - 1;
      p.textContent = last ? `${text} ${isTouchDevice() ? LETTER.mapHintTouch : LETTER.mapHint}` : text;
      panel.appendChild(p);
    });
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
