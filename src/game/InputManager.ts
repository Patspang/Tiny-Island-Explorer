/** Keyboard state for movement. Pointer input for the camera lives in FollowCamera. */

const MOVE_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
} as const;

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface MoveInput {
  /** Strafe axis, -1 (left) to 1 (right). */
  x: number;
  /** Forward axis, -1 (back) to 1 (forward). */
  y: number;
  run: boolean;
  jumpHeld: boolean;
}

export class InputManager {
  private readonly down = new Set<string>();
  private jumpPresses = 0;
  private readonly actionHandlers = new Map<string, () => void>();
  enabled = false;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Register a one-shot action key (e.g. KeyR -> respawn). Fires regardless of `enabled`. */
  onAction(code: string, handler: () => void): void {
    this.actionHandlers.set(code, handler);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (PREVENT_DEFAULT.has(e.code) && this.enabled) e.preventDefault();
    const action = this.actionHandlers.get(e.code);
    if (action && !e.repeat) action();
    if (!this.enabled) return;
    if (!this.down.has(e.code) && (MOVE_KEYS.jump as readonly string[]).includes(e.code)) this.jumpPresses++;
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onVisibility = () => {
    if (document.hidden) this.clear();
  };

  /** Drop every held key, e.g. on focus loss, so the player doesn't keep walking. */
  clear = () => {
    this.down.clear();
    this.jumpPresses = 0;
  };

  private any(codes: readonly string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  read(out: MoveInput): MoveInput {
    if (!this.enabled) {
      out.x = 0;
      out.y = 0;
      out.run = false;
      out.jumpHeld = false;
      return out;
    }
    out.x = (this.any(MOVE_KEYS.right) ? 1 : 0) - (this.any(MOVE_KEYS.left) ? 1 : 0);
    out.y = (this.any(MOVE_KEYS.forward) ? 1 : 0) - (this.any(MOVE_KEYS.back) ? 1 : 0);
    out.run = this.any(MOVE_KEYS.run);
    out.jumpHeld = this.any(MOVE_KEYS.jump);
    return out;
  }

  /** Number of jump key presses since last call. */
  consumeJumpPresses(): number {
    const n = this.jumpPresses;
    this.jumpPresses = 0;
    return n;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
