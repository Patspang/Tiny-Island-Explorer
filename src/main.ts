import './styles.css';
import { Game } from './game/Game';
import { createDebugHandle, type DebugHandle } from './game/debug';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { FinaleScreen, Hint, PauseMenu, QuestHud, StartScreen } from './ui/Overlays';
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
  const start = new StartScreen(app, () => game?.play());
  const pause = new PauseMenu(app, () => game?.resume());
  const finale = new FinaleScreen(app, () => {
    finale.setVisible(false);
    game?.resume();
  });
  const hint = new Hint(app);

  try {
    const physics = await PhysicsWorld.create();
    game = new Game(app, physics, (p) => (mode === 'sandbox' ? new Sandbox(p) : new Island(p)));
    const quest = game.quest;
    const hud = quest ? new QuestHud(app, quest.total) : null;
    game.onQuest = (e) => {
      if (!hud || !quest) return;
      if (e.type === 'collect') {
        hud.setProgress(e.collected, e.total);
        if (e.collected < e.total) hud.message(`Lens piece found! ${e.total - e.collected} to go.`);
      } else if (e.type === 'complete') {
        hud.message('The lens is whole again. Bring it to the lighthouse door!', 5000);
      } else if (e.type === 'hint') {
        hud.message('A beam of light rises somewhere on the island…', 4500);
      } else if (e.type === 'doorLocked') {
        hud.message(`The lens frame by the door is empty. ${e.missing} piece${e.missing === 1 ? '' : 's'} still missing.`, 4000);
      } else if (e.type === 'finaleStart') {
        hud.message('The lighthouse flickers to life…', 4500);
      } else if (e.type === 'done') {
        hud.setDone();
        game?.showOverlay();
        finale.setVisible(true);
      }
    };

    let started = false;
    game.onStateChange = (state) => {
      if (state !== 'title' && !started) {
        started = true;
        start.hide();
        hint.flash();
        if (hud) {
          hud.show();
          hud.message('Find the five lost pieces of the lighthouse lens and bring them to its door.', 5500);
        }
      }
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
