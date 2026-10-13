/* 안드로이드 앱(APK) 안에서만 도는 읽어주기 연결.
 *
 * 앱은 폰에 깔린 모든 음성 엔진(구글·삼성 등)의 한국어 목소리를 `SayeonApp` 으로 내준다.
 * 브라우저의 speechSynthesis 는 기본 엔진 것만 보여 주므로, 앱 안에서는 같은 이름의
 * 가짜 speechSynthesis / SpeechSynthesisUtterance 로 바꿔 끼운다. 그래서
 * 세 페이지와 settings.js 는 앱인지 아닌지 알 필요가 없다.
 * 앱이 아니면(SayeonApp 이 없으면) 아무것도 하지 않는다.
 * 반드시 settings.js 보다 먼저 불러온다. 네이티브 쪽은 android/.../TtsBridge.java.
 */
(function (global) {
  'use strict';
  var app = global.SayeonApp;
  if (!app || typeof app.voices !== 'function' || global.__sayeonTtsShim) return;
  global.__sayeonTtsShim = true;

  var cache = null;
  var listeners = [];
  var queue = [];          // 아직 읽지 않은 발화
  var cur = null;          // 지금 읽는 발화 { id, u }
  var seq = 0;

  function readVoices() {
    var rows;
    try { rows = JSON.parse(app.voices() || '[]'); } catch (e) { rows = []; }
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      out.push({
        name: rows[i].name,
        lang: rows[i].lang || 'ko-KR',
        voiceURI: rows[i].id,
        localService: rows[i].local !== false,
        'default': false
      });
    }
    return out;
  }

  function safe(fn, arg) {
    if (typeof fn !== 'function') return;
    try { fn(arg || {}); } catch (e) {}
  }

  function Utterance(text) {
    this.text = text === undefined ? '' : String(text);
    this.lang = '';
    this.voice = null;
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onboundary = null;
  }

  function begin(u) {
    seq += 1;
    cur = { id: 'u' + seq, u: u };
    synth.speaking = true;
    var rate = typeof u.rate === 'number' && u.rate > 0 ? u.rate : 1;
    try {
      app.speak(cur.id, u.text, (u.voice && u.voice.voiceURI) || '', rate);
    } catch (e) {
      finish('error');
    }
  }

  // 끝났거나 실패했을 때. 핸들러가 곧바로 다음 speak 를 불러도 되도록 먼저 비운다.
  function finish(kind) {
    var done = cur;
    if (!done) return;
    cur = null;
    synth.speaking = false;
    safe(kind === 'end' ? done.u.onend : done.u.onerror, kind === 'end' ? {} : { error: 'synthesis-failed' });
    if (!cur && queue.length) begin(queue.shift());
  }

  var synth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    getVoices: function () {
      if (!cache || !cache.length) cache = readVoices();
      return cache.slice();
    },
    speak: function (u) {
      if (cur) { queue.push(u); } else { begin(u); }
      synth.pending = queue.length > 0;
    },
    // 멈춘 발화는 onend/onerror 를 부르지 않는다 — 부르는 쪽이 다음 일을 이미 정했기 때문이다
    cancel: function () {
      queue = [];
      cur = null;
      synth.speaking = false;
      synth.pending = false;
      try { app.stop(); } catch (e) {}
    },
    pause: function () {},
    resume: function () {},
    addEventListener: function (type, fn) {
      if (type === 'voiceschanged' && typeof fn === 'function') listeners.push(fn);
    },
    removeEventListener: function (type, fn) {
      var at = listeners.indexOf(fn);
      if (type === 'voiceschanged' && at >= 0) listeners.splice(at, 1);
    }
  };

  // 앱이 부르는 곳
  global.__sayeonTts = {
    ready: function () {
      cache = null;
      safe(synth.onvoiceschanged);
      for (var i = 0; i < listeners.length; i++) safe(listeners[i]);
    },
    event: function (id, type) {
      if (!cur || cur.id !== id) return;
      if (type === 'start') safe(cur.u.onstart);
      else if (type === 'end') finish('end');
      else if (type === 'error') finish('error');
    }
  };

  function define(name, value) {
    try {
      Object.defineProperty(global, name, { value: value, configurable: true, writable: true });
    } catch (e) {
      try { global[name] = value; } catch (e2) {}
    }
  }
  define('speechSynthesis', synth);
  define('SpeechSynthesisUtterance', Utterance);
})(window);
