import './styles.css';
import { Game } from './game/Game';
import { createDebugHandle, type DebugHandle } from './game/debug';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { Hint, PauseMenu, StartScreen } from './ui/Overlays';
import { Island } from './world/Island';
import { Sandbox } from './world/Sandbox';

declare global {
  interface Window {
    __game?: DebugHandle;
  }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const params = new URLSearchParams(location.search);
  const mode = params.has('sandbox') ? 'sandbox' : 'island';

  let game: Game | null = null;
  const start = new StartScreen(app, () => {
    if (!game) return;
    start.hide();
    game.play();
    hint.flash();
  });
  const pause = new PauseMenu(app, () => game?.togglePause());
  const hint = new Hint(app);

  try {
    const physics = await PhysicsWorld.create();
    game = new Game(app, physics, (p) => (mode === 'sandbox' ? new Sandbox(p) : new Island(p)));
    game.onStateChange = (state) => {
      pause.setVisible(state === 'paused');
      if (state !== 'playing') hint.hide();
    };
    game.start();
    if (import.meta.env.DEV || params.has('debug')) window.__game = createDebugHandle(game, mode);
    start.setReady();
  } catch (err) {
    console.error(err);
    start.setError(err instanceof Error ? err.message : String(err));
  }
}

void boot();
