// speech.js — narration with two backends behind one interface:
//   1. ElevenLabs (cinematic) via the local /tts proxy, when a key is present.
//   2. The browser's built-in Web Speech API (free) otherwise / on failure.
// The narrator gets a slow, low, grave "true-crime" delivery; every intern gets
// a DISTINCT voice. assignCast(names) is called per game.

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---- ElevenLabs premade voices (stable ids available on every account) -----
// Current ElevenLabs default voices (clean, natural — the legacy Adam/Sam/
// Josh set sounded rough, so they're gone).
const ELEVEN = {
  // Custom narrator voice (ElevenLabs voice library).
  narrator: '66y97vsfcmXgLh93gcal',
  male: [
    'CwhRBWXzGAHq8TQ4Fs17', // Roger — confident
    'JBFqnCBsd6RMkjVDRZzb', // George — warm British
    'onwK4e9ZLuTAKqWW03F9', // Daniel — authoritative British
    'cjVigY5qzO86Huf0OWal', // Eric — middle-aged American
    'iP95p4xoKVk53GoZ742N', // Chris — natural, casual
    'bIHbv24MWmeRgasZH58o', // Will — friendly, young
    'TX3LPaxmHKxFdv7VOQHJ', // Liam — articulate
    'N2lVS1w4EtoT3dr4eOWO', // Callum — intense
  ],
  female: [
    '9BWtsMINqrJLrRacOk9x', // Aria — expressive American
    'EXAVITQu4vr4xnSDxMaL', // Sarah — soft American
    'FGY2WhTYpPnrIDTdsKH5', // Laura — young American
    'XB0fDUnXU5powFXDhCwa', // Charlotte — warm
    'Xb7hH8MSUJpSbSDYk0k2', // Alice — confident British
    'XrExE9yKIg1WjnnlVkGX', // Matilda — warm
    'cgSgspJ2msm6clMCkdW9', // Jessica — young American
    'pFZP5JQG7iQjIQuC4Bku', // Lily — British
  ],
};
function guessFemale(name) { return /a$/i.test(String(name || '').trim()); }

// ---- Web Speech voice discovery -------------------------------------------
let voices = [];
let castNames = [];
const cast = new Map(); // name -> { voice, pitch, rate, elevenVoiceId }

function refreshVoices() {
  if (!supported) return;
  voices = window.speechSynthesis.getVoices() || [];
  if (castNames.length) assignCast(castNames);
}
if (supported) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function hash(s) {
  let h = 0; s = String(s || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function englishVoices() {
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  return en.length ? en : voices;
}
function genderOf(v) {
  const n = (v.name || '').toLowerCase();
  if (/female|samantha|victoria|karen|moira|tessa|fiona|serena|zira|susan|allison|ava|zoe/.test(n)) return 'f';
  if (/male|daniel|arthur|fred|alex|oliver|thomas|george|david|mark|guy|aaron/.test(n)) return 'm';
  return '?';
}
function webVoicePool() {
  const list = englishVoices();
  const m = list.filter((v) => genderOf(v) === 'm');
  const f = list.filter((v) => genderOf(v) === 'f');
  const rest = list.filter((v) => genderOf(v) === '?');
  const out = [];
  for (let i = 0; i < Math.max(m.length, f.length); i++) { if (f[i]) out.push(f[i]); if (m[i]) out.push(m[i]); }
  return out.concat(rest);
}
function webNarratorVoice() {
  const list = englishVoices();
  if (!list.length) return null;
  return list.find((v) => /arthur|daniel|george|thomas|uk english male|male/i.test(v.name))
    || list.find((v) => genderOf(v) === 'm') || list[0];
}

// ---- cast assignment (both backends) --------------------------------------
export function assignCast(names) {
  castNames = Array.isArray(names) ? names.filter(Boolean) : [];
  cast.clear();
  const narV = webNarratorVoice();
  const pool = webVoicePool().filter((v) => v !== narV);
  let mi = 0, fi = 0;
  castNames.forEach((name, i) => {
    const h = hash(name);
    const female = guessFemale(name);
    const elevenVoiceId = female
      ? ELEVEN.female[(fi++) % ELEVEN.female.length]
      : ELEVEN.male[(mi++) % ELEVEN.male.length];
    const wrapped = pool.length && i >= pool.length;
    cast.set(name, {
      voice: pool.length ? pool[i % pool.length] : null,
      pitch: 0.8 + (h % 45) / 100 + (wrapped ? 0.12 : 0),
      rate: 0.94 + ((h >> 3) % 16) / 100,
      elevenVoiceId,
    });
  });
}

// ---- playback -------------------------------------------------------------
let seq = 0;             // token: stale callbacks after cancel() are ignored
let currentAudio = null; // active ElevenLabs <audio>

function stopAudio() {
  if (!currentAudio) return;
  currentAudio.onended = null; currentAudio.onerror = null;
  try { currentAudio.pause(); } catch (e) { /* ignore */ }
  currentAudio.src = '';
  currentAudio = null;
}

function webSpeak(text, voice, rate, pitch, onEnd) {
  if (!supported || !text) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel();
  const id = ++seq;
  const u = new SpeechSynthesisUtterance(String(text));
  if (voice) u.voice = voice;
  u.rate = rate; u.pitch = pitch;
  const done = () => { if (id === seq && onEnd) onEnd(); };
  u.onend = done; u.onerror = done;
  window.speechSynthesis.speak(u);
}

export const speech = {
  supported,
  assignCast,
  eleven: false, // set by init() once the proxy reports a key

  async init() {
    try {
      const r = await fetch('/tts/health', { cache: 'no-cache' });
      if (r.ok) { const j = await r.json(); this.eleven = !!j.enabled; }
    } catch (e) { this.eleven = false; }
    return this.eleven;
  },

  cancel() {
    seq++;
    if (supported) window.speechSynthesis.cancel();
    stopAudio();
  },

  speaking() {
    return (supported && window.speechSynthesis.speaking) || !!currentAudio;
  },

  _playEleven(voiceId, kind, text, onEnd, onFail) {
    const id = ++seq;
    if (supported) window.speechSynthesis.cancel();
    stopAudio();
    fetch('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId, text, kind }),
    })
      .then((r) => { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
      .then((blob) => {
        if (id !== seq) return; // superseded by a newer utterance
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        currentAudio = a;
        const done = () => {
          if (currentAudio === a) currentAudio = null;
          URL.revokeObjectURL(url);
          if (id === seq && onEnd) onEnd();
        };
        a.onended = done; a.onerror = done;
        a.play().catch(() => done());
      })
      .catch(() => { if (id === seq && onFail) onFail(); });
  },

  // The narrator: slow, low, grave. ElevenLabs gets real timed pauses via
  // <break> tags; Web Speech gets ellipses (it would read tags literally).
  narrator(text, onEnd) {
    const plain = String(text || '').trim();
    const web = () => webSpeak(plain.replace(/\.\s+/g, '…  '), webNarratorVoice(), 0.82, 0.68, onEnd);
    if (this.eleven) {
      const dramatic = plain
        .replace(/\.\s+/g, '. <break time="0.5s" /> ')
        .replace(/\s*—\s*/g, ' <break time="0.3s" /> ');
      this._playEleven(ELEVEN.narrator, 'narrator', dramatic, onEnd, web);
    } else {
      web();
    }
  },

  // An intern speaking on the record — their assigned distinct voice.
  actor(name, text, onEnd) {
    const sig = cast.get(name) || { voice: null, pitch: 1, rate: 1 };
    if (this.eleven && sig.elevenVoiceId) {
      this._playEleven(sig.elevenVoiceId, 'actor', text, onEnd, () => webSpeak(text, sig.voice, sig.rate, sig.pitch, onEnd));
    } else {
      webSpeak(text, sig.voice, sig.rate, sig.pitch, onEnd);
    }
  },
};

// Probe the proxy for a key at startup (fire and forget).
speech.init();
