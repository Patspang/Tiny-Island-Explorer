import './styles.css';
import { Game } from './game/Game';
import { createDebugHandle, type DebugHandle } from './game/debug';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { journalLines, NOTES, TOASTS, UI } from './quest/story';
import { MapView } from './ui/MapView';
import { FinaleScreen, Hint, LetterScreen, PauseMenu, QuestHud, SoundToggle, StartScreen } from './ui/Overlays';
import { isTouchDevice, TouchControls } from './ui/TouchControls';
import { Island } from './world/Island';
import { Sandbox } from './world/Sandbox';

/** Where quest progress is kept between visits (this browser only). */
const SAVE_KEY = 'tiny-island-quest';

function loadSave(): unknown {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // Storage blocked or data damaged: start fresh.
  }
}

function writeSave(data: unknown): void {
  try {
    if (data === null) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Not saved (private mode, storage full); the game plays on.
  }
}

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
    game?.audio.unlock();
    game?.play();
  });
  const pause = new PauseMenu(
    app,
    () => game?.resume(),
    () => {
      game?.player.respawn();
      game?.resume();
    },
  );
  const touch = isTouchDevice();
  document.body.classList.toggle('touch', touch);
  if (touch) {
    const rotate = document.createElement('div');
    rotate.className = 'rotate-hint';
    rotate.textContent = UI.rotate;
    app.appendChild(rotate);
  }
  const finale = new FinaleScreen(app, () => {
    finale.setVisible(false);
    game?.resume();
  });
  const hint = new Hint(app);

  try {
    const physics = await PhysicsWorld.create();
    game = new Game(app, physics, (p) => (mode === 'sandbox' ? new Sandbox(p) : new Island(p)));
    const audio = game.audio;
    // Browsers only start audio from a user gesture; any click or key press will do.
    // iOS only counts the end of a touch as a gesture that may start audio.
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const) {
      window.addEventListener(type, () => audio.unlock(), { passive: true });
    }
    const g0 = game;
    const touchControls = touch
      ? new TouchControls(
          app,
          {
            stick: (x, y, run) => g0.input.setStick(x, y, run),
            jump: (down) => g0.input.setTouchJump(down),
            pause: () => g0.togglePause(),
          },
          { jump: UI.jump, pause: UI.pause },
        )
      : null;
    const sound = new SoundToggle(app, () => {
      audio.unlock();
      audio.toggleMute();
    });
    sound.setMuted(audio.isMuted);
    audio.onMuteChange = (muted) => sound.setMuted(muted);
    const quest = game.quest;
    const g = game;
    // The sandbox test level has no story; only the island keeps progress.
    const restored = mode === 'island' && game.restoreQuest(loadSave());
    const mapData = game.world.map;
    const map = mapData
      ? new MapView(app, mapData, () => {
          map!.close();
          g.resume();
        })
      : null;
    const openMap = () => {
      if (!map || !quest || g.state !== 'playing') return;
      const yaw = g.followCamera.yaw;
      g.showOverlay();
      map.open({
        player: { x: g.feetPosition.x, z: g.feetPosition.z },
        facing: { x: -Math.sin(yaw), z: -Math.cos(yaw) },
        found: new Set(quest.pieces.filter((p) => p.collected).map((p) => p.id)),
        bottleRead: quest.bottleRead,
      });
    };
    // The letter leads straight on to the map, so the player sees where to go.
    const letter = new LetterScreen(app, () => {
      letter.setVisible(false);
      g.resume();
      openMap();
    });
    // K for "kaart"; J (the old key) still works.
    const toggleMap = () => {
      if (map?.visible) {
        map.close();
        g.resume();
      } else openMap();
    };
    game.input.onAction('KeyK', toggleMap);
    game.input.onAction('KeyJ', toggleMap);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && map?.visible) {
        map.close();
        g.resume();
      }
    });
    const hud = quest ? new QuestHud(app, quest.total, openMap) : null;
    if (hud && quest && restored) {
      hud.setProgress(quest.collectedCount, quest.total);
      if (quest.state === 'done') hud.setDone();
    }
    game.onQuest = (e) => {
      if (!hud || !quest) return;
      switch (e.type) {
        case 'collect':
          hud.setProgress(e.collected, e.total);
          if (e.collected < e.total) hud.message(TOASTS.pieceFound(e.total - e.collected));
          break;
        case 'complete':
          hud.message(TOASTS.lensWhole);
          break;
        case 'hint':
          hud.message(TOASTS.hint);
          break;
        case 'doorLocked':
          hud.message(TOASTS.doorLocked(e.missing));
          break;
        case 'finaleStart':
          hud.message(TOASTS.finaleStart);
          break;
        case 'done':
          hud.setDone();
          g.showOverlay();
          finale.setVisible(true);
          break;
        case 'bottle':
          g.showOverlay();
          letter.setVisible(true);
          break;
        case 'songStart':
          if (!e.auto) hud.message(TOASTS.songPlaying);
          break;
        case 'bell':
          if (e.kind === 'right') hud.message(TOASTS.bellRight);
          else if (e.kind === 'wrong') hud.message(TOASTS.bellWrong);
          break;
        case 'bellsSolved':
          hud.message(TOASTS.bellsSolved);
          break;
        case 'shell':
          hud.message(TOASTS.shell(e.found, e.total));
          break;
        case 'chestOpen':
          hud.message(TOASTS.chestOpen);
          break;
        case 'dig':
          hud.message(TOASTS.dig);
          break;
        case 'note':
          hud.message(NOTES[e.id]);
          break;
      }
      hud.setJournal(journalLines(quest));
      if (mode === 'island') writeSave(quest.save());
    };

    let started = false;
    game.onStateChange = (state) => {
      if (state !== 'title' && !started) {
        started = true;
        start.hide();
        hint.flash();
        if (hud && quest) {
          hud.show();
          hud.setJournal(journalLines(quest));
          if (quest.state !== 'done') hud.message(quest.bottleRead ? TOASTS.startAfterBottle : TOASTS.start);
        }
      }
      pause.setVisible(state === 'paused');
      touchControls?.setVisible(state === 'playing');
      if (state !== 'playing') hint.hide();
    };
    game.start();
    if (import.meta.env.DEV || params.has('debug')) window.__game = createDebugHandle(game, mode);
    start.setReady(
      restored
        ? () => {
            writeSave(null);
            location.reload();
          }
        : undefined,
    );
  } catch (err) {
    console.error(err);
    start.setError(err instanceof Error ? err.message : String(err));
  }
}

void boot();
