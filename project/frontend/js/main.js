// main.js — bootstrap, event wiring, keyboard. Mutates state, calls render().

import { loadManifest, loadGame } from './data.js';
import {
  state, derive, eventAtT,
  nextT, prevT, nextSpeakerT, prevSpeakerT,
  firstNavigableT, lastT,
} from './state.js';
import { render } from './render.js';
import { speech } from './speech.js';

// ---- narration helpers ----------------------------------------------------

function briefingText() {
  const c = state.caseInfo;
  if (!c) return '';
  return [c.narrator, c.setting].filter(Boolean).join(' ');
}

// Read the current event aloud (statements + accusations), or fall silent.
// Used on manual navigation; autoplay handles its own narration + pacing.
function narrateCurrent() {
  if (!state.audioOn) { speech.cancel(); return; }
  const cur = eventAtT(state.currentT);
  if (!cur) { speech.cancel(); return; }
  if (cur.type === 'statement' || cur.type === 'opening_statement') {
    speech.actor(cur.actor, cur.text);
  } else if (cur.type === 'accusation') {
    speech.actor(cur.actor, cur.reason || `I accuse ${cur.target || 'no one'}.`);
  } else {
    speech.cancel();
  }
}

const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let phaseTimer = null;
function clearPhaseTimer() {
  if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null; }
}

// ---- autoplay -------------------------------------------------------------

let playTimer = null;

// How long to linger on each event before auto-advancing. Long statements get
// more time; markers and tool calls move briskly.
function dwellFor(ev) {
  if (!ev) return 1500;
  switch (ev.type) {
    case 'phase': return 1100;
    case 'tool_call': return 1500;
    case 'belief': return state.showPrivateThoughts ? 2200 : 900;
    case 'accusation': return 2800;
    case 'resolution': return 3000;
    case 'opening_statement':
    case 'statement': {
      const words = String(ev.text || '').trim().split(/\s+/).length;
      return Math.min(9000, Math.max(2600, 900 + words * 35));
    }
    default: return 1500;
  }
}

// Stop autoplay WITHOUT re-rendering (for use inside handlers that render anyway).
function haltPlay() {
  state.playing = false;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  speech.cancel();
}

function advance() {
  const t = nextT(state.currentT);
  if (t === state.currentT) { stopPlay(); return; } // reached the end
  state.currentT = t;
  state.lastStepDir = 1;
  state.drawerDocId = null;
  render();
  const now = eventAtT(state.currentT);
  if (now && now.type === 'win') { stopPlay(); return; } // freeze on the reveal
  playCurrent();
}

// Narrate the current event (if audio is on) and schedule the next advance.
// When a statement/accusation is spoken, we advance on the voice finishing so
// autoplay is paced by the narration; otherwise a fixed dwell timer is used.
function playCurrent() {
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  if (!state.playing) return;
  const cur = eventAtT(state.currentT);
  const spoken = cur && (cur.type === 'statement' || cur.type === 'opening_statement' || cur.type === 'accusation');

  if (state.audioOn && speech.supported && spoken) {
    let moved = false;
    const go = () => { if (moved) return; moved = true; if (state.playing) advance(); };
    const text = cur.type === 'accusation'
      ? (cur.reason || `I accuse ${cur.target || 'no one'}.`)
      : cur.text;
    speech.actor(cur.actor, text, go);
    playTimer = setTimeout(go, 60000); // safety net if onend never fires
  } else {
    const delay = reduceMotion() ? Math.min(dwellFor(cur), 1200) : dwellFor(cur);
    playTimer = setTimeout(() => { if (state.playing) advance(); }, delay);
  }
}

function startPlay() {
  if (state.playing) return;
  clearPhaseTimer();
  // Restart from the top if we're sitting at (or past) the end.
  if (state.currentT >= lastT()) state.currentT = firstNavigableT();
  state.coldOpen = false;
  state.drawerDocId = null;
  state.playing = true;
  render();
  playCurrent();
}

function stopPlay() {
  haltPlay();
  render();
}

// After a forward step, phase markers play a brief beat then auto-continue.
function maybeAutoAdvancePhase() {
  clearPhaseTimer();
  const cur = eventAtT(state.currentT);
  if (!cur || cur.type !== 'phase') return;
  const delay = reduceMotion() ? 350 : 950;
  phaseTimer = setTimeout(() => {
    phaseTimer = null;
    const t = nextT(state.currentT);
    if (t !== state.currentT) {
      state.currentT = t;
      state.lastStepDir = 1;
      render();
      narrateCurrent();
      maybeAutoAdvancePhase(); // chain through consecutive phase markers
    }
  }, delay);
}

async function openGame(id) {
  clearPhaseTimer();
  haltPlay();
  state.loading = true;
  render();
  try {
    const { records, meta, caseInfo, evaluation } = await loadGame(id);
    state.records = records;
    state.meta = meta;
    state.caseInfo = caseInfo;
    state.evaluation = evaluation;
    // Give each intern a distinct narration voice for this game's cast.
    const gs = records.find((e) => e.type === 'game_start');
    const cast = (meta?.suspects || gs?.suspects || []).map((s) => s.name || s).filter(Boolean);
    speech.assignCast(cast);
    state.selectedGame = id;
    state.currentT = 0;
    state.coldOpen = true;
    state.viewMode = 'replay';
    state.showPrivateThoughts = false;
    state.focusedIntern = null;
    state.drawerDocId = null;
    state.lastStepDir = 0;
    state.playing = false;
    state.error = null;
  } catch (e) {
    state.error = String(e && e.message ? e.message : e);
  } finally {
    state.loading = false;
    render();
    if (state.audioOn && state.coldOpen) speech.narrator(briefingText());
  }
}

function toPicker() {
  clearPhaseTimer();
  haltPlay();
  state.selectedGame = null;
  state.records = [];
  state.meta = null;
  state.caseInfo = null;
  state.evaluation = null;
  state.focusedIntern = null;
  state.drawerDocId = null;
  state.coldOpen = false;
  render();
}

function step(kind) {
  clearPhaseTimer();
  haltPlay();
  const map = {
    next: nextT, prev: prevT,
    'next-speaker': nextSpeakerT, 'prev-speaker': prevSpeakerT,
  };
  const fn = map[kind];
  if (!fn) return;
  const t = fn(state.currentT);
  state.lastStepDir = kind.startsWith('prev') ? -1 : 1;
  state.currentT = t;
  state.coldOpen = false;
  state.drawerDocId = null;
  render();
  narrateCurrent();
  if (state.lastStepDir > 0) maybeAutoAdvancePhase();
}

// ---- action dispatch (event delegation) -----------------------------------

function handleAction(action, el) {
  switch (action) {
    case 'open-game': return openGame(el.dataset.id);
    case 'to-picker': return toPicker();
    case 'begin':
      clearPhaseTimer();
      haltPlay();
      state.coldOpen = false;
      state.currentT = firstNavigableT();
      render();
      narrateCurrent();
      return;
    case 'toggle-play':
      if (state.playing) stopPlay(); else startPlay();
      return;
    case 'toggle-audio':
      state.audioOn = !state.audioOn;
      render();
      if (!state.audioOn) speech.cancel();
      else if (state.coldOpen) speech.narrator(briefingText());
      else if (!state.playing) narrateCurrent();
      return;
    case 'prev': case 'next':
    case 'prev-speaker': case 'next-speaker':
      return step(action);
    case 'goto':
      clearPhaseTimer();
      haltPlay();
      state.currentT = Number(el.dataset.t);
      state.lastStepDir = 0;
      state.coldOpen = false;
      state.drawerDocId = null;
      render();
      narrateCurrent();
      return;
    case 'mode':
      clearPhaseTimer();
      haltPlay();
      state.viewMode = el.dataset.mode;
      render();
      return;
    case 'toggle-private':
      state.showPrivateThoughts = !state.showPrivateThoughts;
      render();
      return;
    case 'focus': {
      const name = el.dataset.name || null;
      // In replay a desk click toggles the private-corner focus; in dossier it
      // selects the subject.
      if (state.viewMode === 'replay' && state.focusedIntern === name) state.focusedIntern = null;
      else state.focusedIntern = name;
      render();
      return;
    }
    case 'doc':
      state.drawerDocId = el.dataset.doc;
      render();
      return;
    case 'close-drawer':
      state.drawerDocId = null;
      render();
      return;
  }
}

function onClick(ev) {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  ev.preventDefault();
  handleAction(el.dataset.action, el);
}

function onKey(ev) {
  if (!state.selectedGame) return;
  // let space/enter activate focused buttons normally
  if (state.drawerDocId && ev.key === 'Escape') { state.drawerDocId = null; render(); return; }
  if (state.coldOpen) {
    if (ev.key === 'Enter' || ev.key === 'ArrowRight') { handleAction('begin', {}); ev.preventDefault(); }
    return;
  }
  if (state.viewMode !== 'replay') {
    if (ev.key === 'Escape' && state.focusedIntern) { state.focusedIntern = null; render(); }
    return;
  }
  if (ev.key === ' ' || ev.code === 'Space') {
    const tag = ev.target && ev.target.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') return; // let space activate the focused control
    ev.preventDefault();
    if (state.playing) stopPlay(); else startPlay();
    return;
  }
  switch (ev.key) {
    case 'ArrowRight': ev.preventDefault(); step(ev.shiftKey ? 'next-speaker' : 'next'); break;
    case 'ArrowLeft': ev.preventDefault(); step(ev.shiftKey ? 'prev-speaker' : 'prev'); break;
    case 'p': case 'P': state.showPrivateThoughts = !state.showPrivateThoughts; render(); break;
    case 'Escape':
      if (state.focusedIntern) { state.focusedIntern = null; render(); }
      break;
  }
}

let resizeRAF = null;
function onResize() {
  if (!state.selectedGame || state.viewMode !== 'replay' || state.coldOpen) return;
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => {
    import('./warroom.js').then((m) => m.drawBoardStrings(derive()));
  });
}

async function boot() {
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  try {
    state.manifest = await loadManifest();
    if (!state.manifest.games || state.manifest.games.length === 0) {
      state.error = 'No games found in manifest.json. Run: node build-manifest.js';
    }
  } catch (e) {
    state.error = String(e && e.message ? e.message : e);
  } finally {
    state.loading = false;
    render();
  }
}

boot();
