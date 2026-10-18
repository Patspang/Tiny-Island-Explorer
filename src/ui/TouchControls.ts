/**
 * On-screen controls for phones and tablets: a thumb stick (bottom-left) that appears where the
 * thumb lands, a jump button (bottom-right) and a pause button (top-right). Dragging anywhere
 * else on the screen still turns the camera (FollowCamera), and two fingers pinch to zoom.
 * Plain DOM; it only reports input and never touches game state itself.
 */

export interface TouchControlsEvents {
  /** Stick deflection: x right, y forward, each -1..1; `run` when pushed all the way. */
  stick(x: number, y: number, run: boolean): void;
  jump(down: boolean): void;
  pause(): void;
}

/** Stick travel in CSS pixels; the knob stops at this radius. */
const STICK_RADIUS = 56;
/** Ignore tiny thumb wobble around the centre. */
const DEAD_ZONE = 0.12;
/** Pushing past this fraction of the travel switches from walking to running. */
const RUN_THRESHOLD = 0.92;

/** Phones and tablets: the main pointer is a finger. `?touch` forces it on (tests, desktop). */
export function isTouchDevice(): boolean {
  return new URLSearchParams(location.search).has('touch') || window.matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  readonly el: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private stickPointer: number | null = null;
  private readonly origin = { x: 0, y: 0 };
  private jumpPointer: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly events: TouchControlsEvents,
    labels: { jump: string; pause: string },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'touch-controls hidden';

    this.zone = document.createElement('div');
    this.zone.className = 'touch-stick-zone';
    this.base = document.createElement('div');
    this.base.className = 'touch-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'touch-jump';
    jump.setAttribute('aria-label', labels.jump);
    jump.innerHTML = `<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 4l7 8h-4v8H9v-8H5z" fill="currentColor"/></svg>`;

    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'touch-pause';
    pause.setAttribute('aria-label', labels.pause);
    pause.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>`;

    this.el.append(this.zone, jump, pause);
    parent.appendChild(this.el);

    this.zone.addEventListener('pointerdown', this.onStickDown);
    this.zone.addEventListener('pointermove', this.onStickMove);
    this.zone.addEventListener('pointerup', this.onStickUp);
    this.zone.addEventListener('pointercancel', this.onStickUp);

    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.jumpPointer = e.pointerId;
      jump.setPointerCapture(e.pointerId);
      jump.classList.add('pressed');
      this.events.jump(true);
    });
    const jumpUp = (e: PointerEvent) => {
      if (e.pointerId !== this.jumpPointer) return;
      this.jumpPointer = null;
      jump.classList.remove('pressed');
      this.events.jump(false);
    };
    jump.addEventListener('pointerup', jumpUp);
    jump.addEventListener('pointercancel', jumpUp);
    pause.addEventListener('click', () => {
      pause.blur();
      this.events.pause();
    });
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible);
    if (!visible) this.release();
  }

  /** Let go of everything (overlay opened, focus lost). */
  release(): void {
    if (this.stickPointer !== null) {
      this.stickPointer = null;
      this.base.classList.remove('active');
      this.events.stick(0, 0, false);
    }
    if (this.jumpPointer !== null) {
      this.jumpPointer = null;
      this.events.jump(false);
    }
  }

  private onStickDown = (e: PointerEvent) => {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    // The stick appears under the thumb, wherever it lands in the zone.
    const r = this.zone.getBoundingClientRect();
    this.origin.x = e.clientX;
    this.origin.y = e.clientY;
    this.base.style.left = `${e.clientX - r.left}px`;
    this.base.style.top = `${e.clientY - r.top}px`;
    this.base.classList.add('active');
    this.moveKnob(0, 0);
  };

  private onStickMove = (e: PointerEvent) => {
    if (e.pointerId !== this.stickPointer) return;
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    this.moveKnob(dx, dy);
    const amount = Math.min(1, len / STICK_RADIUS);
    if (amount < DEAD_ZONE) {
      this.events.stick(0, 0, false);
      return;
    }
    // Rescale past the dead zone so a small push still starts a slow walk.
    const k = (amount - DEAD_ZONE) / (1 - DEAD_ZONE) / Math.max(amount, 1e-6);
    this.events.stick((dx / STICK_RADIUS) * k, (-dy / STICK_RADIUS) * k, amount >= RUN_THRESHOLD);
  };

  private onStickUp = (e: PointerEvent) => {
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.base.classList.remove('active');
    this.events.stick(0, 0, false);
  };

  private moveKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
