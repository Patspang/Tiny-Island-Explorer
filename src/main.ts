import './styles.css';
import { Game } from './game/Game';
import { createDebugHandle, type DebugHandle } from './game/debug';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { journalLines, NOTES, TOASTS } from './quest/story';
import { MapView } from './ui/MapView';
import { FinaleScreen, Hint, LetterScreen, PauseMenu, QuestHud, SoundToggle, StartScreen } from './ui/Overlays';
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
    game?.audio.unlock();
    game?.play();
  });
  const pause = new PauseMenu(app, () => game?.resume());
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
    for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => audio.unlock(), { passive: true });
    const sound = new SoundToggle(app, () => {
      audio.unlock();
      audio.toggleMute();
    });
    sound.setMuted(audio.isMuted);
    audio.onMuteChange = (muted) => sound.setMuted(muted);
    const quest = game.quest;
    const g = game;
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
    game.onQuest = (e) => {
      if (!hud || !quest) return;
      switch (e.type) {
        case 'collect':
          hud.setProgress(e.collected, e.total);
          if (e.collected < e.total) hud.message(TOASTS.pieceFound(e.total - e.collected));
          break;
        case 'complete':
          hud.message(TOASTS.lensWhole, 5000);
          break;
        case 'hint':
          hud.message(TOASTS.hint, 4500);
          break;
        case 'doorLocked':
          hud.message(TOASTS.doorLocked(e.missing), 4000);
          break;
        case 'finaleStart':
          hud.message(TOASTS.finaleStart, 4500);
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
          if (!e.auto) hud.message(TOASTS.songPlaying, 3000);
          break;
        case 'bell':
          if (e.kind === 'right') hud.message(TOASTS.bellRight, 1600);
          else if (e.kind === 'wrong') hud.message(TOASTS.bellWrong, 4000);
          break;
        case 'bellsSolved':
          hud.message(TOASTS.bellsSolved, 6000);
          break;
        case 'shell':
          hud.message(TOASTS.shell(e.found, e.total), 3500);
          break;
        case 'chestOpen':
          hud.message(TOASTS.chestOpen, 5000);
          break;
        case 'dig':
          hud.message(TOASTS.dig, 4500);
          break;
        case 'note':
          // Young readers need time: notes stay up longer than other messages.
          hud.message(NOTES[e.id], 9000);
          break;
      }
      hud.setJournal(journalLines(quest));
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
          hud.message(quest.bottleRead ? TOASTS.startAfterBottle : TOASTS.start, 5500);
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
