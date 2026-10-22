// render.js — the single render entry point. Pure function of `state`.

import { state, derive } from './state.js';
import { renderPicker } from './picker.js';
import { renderWarRoom, drawBoardStrings } from './warroom.js';

const app = () => document.getElementById('app');

function screen(inner) {
  return `<div class="h-full w-full flex items-center justify-center text-center px-6">${inner}</div>`;
}

export function render() {
  const el = app();

  if (state.error) {
    el.innerHTML = screen(`
      <div>
        <div class="font-display text-3xl text-crimson-bright">Could not load the archive</div>
        <p class="text-white/50 mt-3 max-w-md font-type text-sm">${state.error}</p>
        <p class="text-white/30 mt-4 text-xs">Serve the folder over http (e.g. <code>python3 -m http.server</code>)
          rather than opening the file directly — <code>fetch</code> is blocked on <code>file://</code>.</p>
      </div>`);
    return;
  }

  if (state.loading) {
    el.innerHTML = screen(`<div class="font-display text-2xl text-white/50 tracking-wider2 animate-pulse">LOADING CASE ARCHIVE…</div>`);
    return;
  }

  if (!state.selectedGame) {
    el.innerHTML = renderPicker(state.manifest.images, state.manifest.games);
    return;
  }

  const dv = derive();
  el.innerHTML = renderWarRoom(dv);

  // Strings need measured desk positions, so draw them after layout.
  if (state.viewMode === 'replay' && !state.coldOpen) {
    requestAnimationFrame(() => drawBoardStrings(dv));
  }
}
