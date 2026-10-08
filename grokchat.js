// Club House (Dubai phone): in-app Grok quick chat with the 11 crew bots.
// - The chat goes to our relay (Cloudflare Pages Function), which holds the xAI key and the bots' role texts.
// - History is kept ONLY on this phone (IndexedDB, keys "ch.dubai.chat.<bot>"); it is separate from the
//   real bots' memory in the Grok Bot app.
// - Used by index.html (the panel) and club.html (Back up / Restore context).
(function () {
  'use strict';

  // ===== The one setting to change after deploying the relay =====
  const RELAY_URL = 'https://ch-relay.pages.dev';
  // ================================================================

  const PREFIX = 'ch.dubai.chat.';
  const CFG = 'ch.dubai.chatcfg.';
  const SNAP_KEY = 'ch.dubai.chatbackup.before-restore';
  const BOT_IDS = ['ralph', 'alexa', 'miranda', 'priya', 'jack', 'millie', 'orange', 'amra', 'metaads', 'orchidwest', 'mellow'];
  const KEEP_PER_BOT = 200;   // messages kept on the phone per bot
  const SEND_TURNS = 12;      // messages sent to the relay (it trims to 12 too)
  const MAX_INPUT = 2000;
  const FAST_MODEL = 'grok-4.20-non-reasoning', THINK_MODEL = 'grok-4.7';

  // ---------- storage: IndexedDB with a localStorage fallback ----------
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        if (!('indexedDB' in window)) return resolve(null);
        const r = indexedDB.open('ch.dubai.chat', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  async function kvGet(key) {
    const d = await db();
    if (!d) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
    return new Promise((res) => {
      try { const q = d.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result == null ? null : q.result); q.onerror = () => res(null); }
      catch (e) { res(null); }
    });
  }
  async function kvSet(key, val) {
    const d = await db();
    if (!d) { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }
    return new Promise((res) => {
      try {
        const t = d.transaction('kv', 'readwrite'), s = t.objectStore('kv');
        val == null ? s.delete(key) : s.put(val, key);
        t.oncomplete = () => res(true); t.onerror = () => res(false); t.onabort = () => res(false);
      } catch (e) { res(false); }
    });
  }
  const getChat = async (bot) => { const v = await kvGet(PREFIX + bot); return Array.isArray(v) ? v : []; };
  const setChat = (bot, msgs) => kvSet(PREFIX + bot, msgs.slice(-KEEP_PER_BOT));

  let persistAsked = false;
  function askPersist() {
    if (persistAsked) return; persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  }

  // ---------- backup / restore (used by club.html) ----------
  function isMsg(m) {
    return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 12000 &&
      (m.ts == null || Number.isFinite(m.ts));
  }
  async function exportAll() {
    const chats = {};
    for (const id of BOT_IDS) { const c = await getChat(id); if (c.length) chats[id] = c; }
    return { format: 'ch-dubai-grok-chats', version: 1, chats };
  }
  function validate(v) {
    if (!v || v.format !== 'ch-dubai-grok-chats' || v.version !== 1 || !v.chats || typeof v.chats !== 'object') throw new Error('Unsupported bot chat backup.');
    for (const k of Object.keys(v.chats)) {
      if (!BOT_IDS.includes(k)) throw new Error('Unknown bot in chat backup.');
      const list = v.chats[k];
      if (!Array.isArray(list) || list.length > KEEP_PER_BOT || !list.every(isMsg)) throw new Error('Invalid chat for ' + k + '.');
    }
    return v;
  }
  async function importAll(v) {
    validate(v);
    await kvSet(SNAP_KEY, await exportAll());   // keep current chats as a recovery copy
    for (const id of BOT_IDS) {
      if (v.chats[id]) await setChat(id, v.chats[id].map(m => ({ role: m.role, content: m.content, ts: m.ts || 0 })));
    }
  }
  async function recoverPrevious() {
    const snap = await kvGet(SNAP_KEY);
    if (!snap) return false;
    validate(snap);
    const now = await exportAll();
    for (const id of BOT_IDS) await setChat(id, snap.chats[id] || []);
    await kvSet(SNAP_KEY, now);
    return true;
  }

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmt(s) { // plain text, keep line breaks, allow **bold**
    return esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  }
  const cfgGet = (k) => { try { return localStorage.getItem(CFG + k); } catch (e) { return null; } };
  const cfgSet = (k, v) => { try { v == null ? localStorage.removeItem(CFG + k) : localStorage.setItem(CFG + k, v); } catch (e) {} };
  const SPEAK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  // ---------- voice (speechSynthesis; uses the Voice pick from the Club page if set) ----------
  let speakingBtn = null;
  function stopSpeech() { try { speechSynthesis.cancel(); } catch (e) {} if (speakingBtn) { speakingBtn.innerHTML = SPEAK; speakingBtn.classList.remove('on'); speakingBtn = null; } }
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) return;
    const again = speakingBtn === btn; stopSpeech(); if (again) return;
    const u = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ''));
    try { const want = localStorage.getItem('bolt-voice-name'); const v = want && speechSynthesis.getVoices().find(x => x.name === want); if (v) u.voice = v; else u.lang = 'en-GB'; } catch (e) {}
    if (btn) { speakingBtn = btn; btn.innerHTML = STOP; btn.classList.add('on'); }
    u.onend = u.onerror = () => { if (speakingBtn === btn) stopSpeech(); };
    speechSynthesis.speak(u);
  }

  // ---------- panel ----------
  let el = null, bots = [], cur = null, msgs = [], busy = null;
  const drafts = {};

  function build() {
    if (el) return el;
    const back = document.createElement('div'); back.className = 'gc-back'; back.hidden = true;
    const s = document.createElement('section');
    s.className = 'gc'; s.hidden = true; s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'gcName');
    s.innerHTML = `
      <div class="gc-grip" aria-hidden="true"></div>
      <div class="gc-head">
        <span class="av gc-av"><img id="gcImg" alt="" width="44" height="44"></span>
        <div class="gc-id"><b id="gcName"></b><small id="gcRole"></small></div>
        <button type="button" class="gc-x" id="gcClose" aria-label="Close chat">✕</button>
      </div>
      <p class="gc-sep" id="gcSep"></p>
      <div class="gc-tools">
        <label class="gc-tg"><input type="checkbox" id="gcAuto"><span>Auto-read</span></label>
        <label class="gc-tg" title="Uses grok-4.7: slower and costs a little more"><input type="checkbox" id="gcThink"><span>Think harder</span></label>
        <button type="button" class="gc-clear" id="gcClear">Clear chat</button>
      </div>
      <div class="gc-off">You're offline. Chat needs internet. Your history is safe on this phone.</div>
      <div class="gc-log" id="gcLog" aria-live="polite"></div>
      <form class="gc-pass" id="gcPass" hidden autocomplete="off">
        <label for="gcPassIn">Chat passcode <small>(once on this phone)</small></label>
        <div class="gc-row"><input id="gcPassIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Passcode"><button type="submit">Save</button></div>
        <p class="gc-passmsg" id="gcPassMsg"></p>
      </form>
      <form class="gc-in" id="gcForm">
        <textarea id="gcText" rows="1" maxlength="${MAX_INPUT}" enterkeyhint="send" aria-label="Message"></textarea>
        <button type="submit" id="gcSend" aria-label="Send">Send</button>
      </form>
      <a class="gc-open" id="gcOpen" href="#">Open in Grok Bot app ↗</a>`;
    document.body.append(back, s);
    el = { back, s, $: (id) => s.querySelector('#' + id) };

    back.addEventListener('click', close);
    el.$('gcClose').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !s.hidden) close(); });
    el.$('gcAuto').addEventListener('change', (e) => { cfgSet('autoread', e.target.checked ? '1' : null); if (!e.target.checked) stopSpeech(); });
    el.$('gcThink').addEventListener('change', (e) => cfgSet('think', e.target.checked ? '1' : null));
    el.$('gcClear').addEventListener('click', async () => {
      if (!cur || !msgs.length) return;
      if (!confirm('Clear your Club House chat with ' + cur.name + '? (Your Grok Bot app chat is not affected.)')) return;
      stopSpeech(); msgs = []; await setChat(cur.id, msgs); render();
    });
    el.$('gcPass').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = el.$('gcPassIn').value.trim();
      if (!v) return;
      cfgSet('passcode', v); el.$('gcPassIn').value = ''; el.$('gcPassMsg').textContent = '';
      gate(); el.$('gcText').focus();
    });
    const ta = el.$('gcText');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover:hover)').matches) { e.preventDefault(); el.$('gcForm').requestSubmit(); } });
    el.$('gcForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) { busy.abort(); return; }
      const t = ta.value.trim(); if (!t) return;
      ta.value = ''; grow(); send(t);
    });
    el.$('gcLog').addEventListener('click', (e) => {
      const b = e.target.closest('.gc-say'); if (!b) return;
      const m = msgs[Number(b.dataset.i)]; if (m) speak(m.content, b);
    });
    // keep the sheet above the iPhone keyboard
    const vv = window.visualViewport;
    if (vv) {
      const fit = () => { s.style.setProperty('--kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px'); s.style.setProperty('--vvh', vv.height + 'px'); };
      vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
    }
    return el;
  }

  function gate() {
    const need = !cfgGet('passcode');
    el.$('gcPass').hidden = !need;
    el.$('gcForm').hidden = need;
  }

  function bubble(m, i, streaming) {
    if (m.role === 'user') return `<div class="gc-m u">${fmt(m.content)}</div>`;
    const say = ('speechSynthesis' in window) && !streaming ? `<button type="button" class="gc-say" data-i="${i}" aria-label="Read aloud">${SPEAK}</button>` : '';
    return `<div class="gc-m a${streaming ? ' typing' : ''}"><span class="gc-t">${m.content ? fmt(m.content) : '<i class="gc-dots"><i></i><i></i><i></i></i>'}</span>${say}</div>`;
  }
  function render(note) {
    const log = el.$('gcLog');
    if (!msgs.length && !note) {
      log.innerHTML = `<div class="gc-empty">Ask ${esc(cur.name)} anything (${esc(cur.role)}).<br>Tip: tap 🎤 on your keyboard to talk instead of typing.</div>`;
    } else {
      log.innerHTML = msgs.map((m, i) => bubble(m, i, busy && i === msgs.length - 1 && m.role === 'assistant')).join('') +
        (note ? `<div class="gc-m err" role="alert">${esc(note)}</div>` : '');
    }
    log.scrollTop = log.scrollHeight;
  }
  function setBusy(on) {
    const b = el.$('gcSend');
    b.textContent = on ? 'Stop' : 'Send'; b.classList.toggle('stop', !!on); b.setAttribute('aria-label', on ? 'Stop' : 'Send');
  }

  async function open(id) {
    const b = bots.find(x => x.id === id); if (!b) return false;
    build(); askPersist();
    if (busy) busy.abort();
    stopSpeech();
    const ta = el.$('gcText');
    if (cur) drafts[cur.id] = ta.value;            // keep an unsent message per bot
    ta.value = drafts[b.id] || ''; ta.style.height = 'auto';
    el.$('gcPassMsg').textContent = '';
    cur = b;
    el.s.style.setProperty('--c', b.color);
    el.$('gcImg').src = 'bots/' + b.id + '.jpg';
    el.$('gcName').textContent = b.name;
    el.$('gcRole').textContent = b.role;
    el.$('gcSep').textContent = `Quick chat · separate from ${b.name}'s Grok Bot memory`;
    el.$('gcText').placeholder = `Message ${b.name}…`;
    el.$('gcOpen').href = 'grokbot://app/v1/agent?id=' + b.agent;
    el.$('gcAuto').checked = cfgGet('autoread') === '1';
    el.$('gcThink').checked = cfgGet('think') === '1';
    msgs = await getChat(b.id);
    gate(); render();
    el.back.hidden = false; el.s.hidden = false;
    document.documentElement.classList.add('gc-lock');
    requestAnimationFrame(() => { el.back.classList.add('on'); el.s.classList.add('on'); });
    return true;
  }
  function close() {
    if (!el || el.s.hidden) return;
    if (busy) busy.abort();
    stopSpeech();
    el.back.classList.remove('on'); el.s.classList.remove('on');
    document.documentElement.classList.remove('gc-lock');
    setTimeout(() => { el.back.hidden = true; el.s.hidden = true; }, 220);
  }

  async function send(text) {
    const bot = cur;
    if (!navigator.onLine) { el.$('gcText').value = text; return render('You\'re offline. Your message is still in the box; send it when you have signal.'); }
    if (/PLACEHOLDER/.test(RELAY_URL)) { el.$('gcText').value = text; return render('The chat relay isn\'t switched on yet. For now, use "Open in Grok Bot app" below.'); }
    const pass = cfgGet('passcode'); if (!pass) { el.$('gcText').value = text; return gate(); }

    const user = { role: 'user', content: text.slice(0, MAX_INPUT), ts: Date.now() };
    msgs.push(user);
    await setChat(bot.id, msgs);
    const reply = { role: 'assistant', content: '', ts: Date.now() };
    msgs.push(reply);
    const ctrl = new AbortController(); busy = ctrl; setBusy(true); render();
    const timer = setTimeout(() => ctrl.abort(), 100000);
    let note = '', failed = false, cut = false;
    try {
      const res = await fetch(RELAY_URL.replace(/\/$/, '') + '/api/chat', {
        method: 'POST', mode: 'cors', cache: 'no-store', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Panel-Passcode': pass },
        body: JSON.stringify({
          bot: bot.id,
          model: cfgGet('think') === '1' ? THINK_MODEL : FAST_MODEL,
          messages: msgs.slice(0, -1).slice(-SEND_TURNS).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) {
        let j = null; try { j = await res.json(); } catch (e) {}
        failed = true;
        note = (j && j.message) || `The chat relay answered ${res.status}. Try again.`;
        if (res.status === 401) { cfgSet('passcode', null); if (el) el.$('gcPassMsg').textContent = note; }
      } else {
        const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', last = 0;
        outer: for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let k;
          while ((k = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, k).trim(); buf = buf.slice(k + 2);
            if (!line.startsWith('data:')) continue;
            let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
            if (ev.d) reply.content += ev.d;
            if (ev.error) { note = ev.error; break outer; }
            if (ev.done) { cut = !!ev.cut; break outer; }
          }
          if (cur === bot && Date.now() - last > 60) { last = Date.now(); render(); }
        }
        try { rd.cancel(); } catch (e) {}
        if (!reply.content && !note) { failed = true; note = 'No answer came back. Try again.'; }
      }
    } catch (e) {
      if (ctrl.signal.aborted) { if (!reply.content) failed = true; if (cur === bot && el && !el.s.hidden) note = reply.content ? '' : 'Stopped.'; }
      else { failed = true; note = navigator.onLine ? 'Couldn\'t reach the chat relay. Check your signal, or use "Open in Grok Bot app".' : 'You\'re offline. Send it again when you have signal.'; }
    } finally { clearTimeout(timer); }

    if (busy === ctrl) busy = null;
    if (failed) {
      // undo: take the question back out and put it in the box so nothing is lost
      msgs = msgs.filter(m => m !== reply && m !== user);
      if (cur === bot && el) el.$('gcText').value = text;
    } else {
      if (!reply.content) msgs = msgs.filter(m => m !== reply);
      if (cut) reply.content += ' …';
    }
    await setChat(bot.id, msgs);
    if (cur !== bot || !el) return;
    setBusy(false); gate(); render(note);
    if (!failed && reply.content && cfgGet('autoread') === '1' && !el.s.hidden) {
      const i = msgs.indexOf(reply); const b = el.$('gcLog').querySelector(`.gc-say[data-i="${i}"]`);
      speak(reply.content, b);
    }
  }

  function initPanel(list) { bots = list || []; }

  window.CHChat = { RELAY_URL, PREFIX, initPanel, open, close, exportAll, importAll, validate, recoverPrevious, getChat, setChat };
})();
