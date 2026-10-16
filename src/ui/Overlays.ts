/** Start screen and pause menu. Plain DOM; styling lives in styles.css. */

const CONTROLS: ReadonlyArray<[string, string]> = [
  ['W A S D / Arrows', 'Move'],
  ['Shift', 'Run'],
  ['Space', 'Jump'],
  ['Drag mouse', 'Look around'],
  ['Mouse wheel', 'Zoom'],
  ['R', 'Back to the beach'],
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
        <p class="eyebrow">A small island adventure</p>
        <h1>Tiny Island Explorer</h1>
        <p class="subtitle">Wander the beaches, climb the hill, and find the old lighthouse.</p>
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
    this.el.textContent = 'Esc to pause · R to return to the beach';
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
