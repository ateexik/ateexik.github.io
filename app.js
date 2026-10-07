// FakeTaxi Kučera — kto ráno sedí v aute.

const CFG = {
  driver: "Karol",
  seats: 4,
  departure: "07:20",
  daysAhead: 5,
  statsDays: 30,
  driverPinHash: "",
  firebase: null,
  ...(window.FAKETAXI_CONFIG || {}),
};

const FIREBASE_VERSION = "12.18.0";
const SEATS = Array.from({ length: Math.min(Math.max(CFG.seats | 0, 1), 8) }, (_, i) => `s${i + 1}`);
const [DEP_H, DEP_M] = String(CFG.departure).split(":").map(Number);

const DAY_NAMES = ["nedeľa", "pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota"];
const DAY_SHORT = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
const MONTHS = ["januára", "februára", "marca", "apríla", "mája", "júna", "júla", "augusta", "septembra", "októbra", "novembra", "decembra"];

// ---------- pomocníci ----------

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const departureOf = (k) => { const d = dateOf(k); d.setHours(DEP_H, DEP_M, 0, 0); return d; };
const isLocked = (k, now) => now >= departureOf(k);
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clip = (s, n) => [...String(s || "").replace(/\s+/g, " ").trim()].slice(0, n).join("").trim();
const cleanName = (s) => clip(s, 24);
const sameName = (a, b) => a.trim().toLocaleLowerCase("sk") === b.trim().toLocaleLowerCase("sk");
const hueOf = (s) => [...s.toLocaleLowerCase("sk")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const chunk = (arr, n) => arr.reduce((rows, x, i) => (i % n ? rows[rows.length - 1].push(x) : rows.push([x]), rows), []);

function randomId(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
}

// localStorage, ktorý neskolabuje v súkromnom okne
const memory = {};
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return memory[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { memory[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete memory[k]; } },
};

function dayTitle(k) {
  const d = dateOf(k);
  const name = DAY_NAMES[d.getDay()];
  return `${name[0].toUpperCase()}${name.slice(1)} ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

function seatLabel(id) {
  const i = SEATS.indexOf(id);
  if (i === 0) return "Vpredu";
  const row = Math.floor((i - 1) / 3);
  const inRow = Math.min(3, SEATS.length - 1 - row * 3);
  const cols = inRow === 3 ? ["vľavo", "v strede", "vpravo"] : inRow === 2 ? ["vľavo", "vpravo"] : [""];
  return `${row === 0 ? "Vzadu" : `${row + 2}. rad`} ${cols[(i - 1) % 3]}`.trim();
}

// V aute je málo miesta: „Vzadu vľavo“ → „vľavo“
const seatShort = (id) => seatLabel(id).replace(/^(Vzadu|\d\. rad) /, "");

// Školské dni: dnešok (aj keď už auto odišlo) + daysAhead dní, na ktoré sa ešte dá rezervovať
function visibleDays(now) {
  const out = [];
  let open = 0;
  for (let i = 0, d = addDays(now, 0); i < 21 && open < CFG.daysAhead; i++, d = addDays(d, 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const k = keyOf(d);
    out.push(k);
    if (!isLocked(k, now)) open++;
  }
  return out;
}

// ---------- logika jedného dňa (rovnaká pre demo aj Firebase) ----------

class Oops extends Error {}
const fail = (msg) => { throw new Oops(msg); };

function norm(raw) {
  const day = raw ? JSON.parse(JSON.stringify(raw)) : {};
  day.seats = day.seats || {};
  day.waitlist = day.waitlist || {};
  return day;
}

function finalize(day) {
  const out = {};
  if (Object.keys(day.seats).length) out.seats = day.seats;
  if (Object.keys(day.waitlist).length) out.waitlist = day.waitlist;
  if (day.cancelled) out.cancelled = true;
  if (day.note) out.note = day.note;
  return Object.keys(out).length ? out : null;
}

const person = (me) => ({ name: me.name, device: me.device, ts: Date.now() });
const people = (day) => [...Object.values(day.seats), ...Object.values(day.waitlist)];
const nameTaken = (day, name, except) => people(day).some((p) => p.device !== except && sameName(p.name, name));
const freeSeats = (day) => SEATS.filter((id) => !day.seats[id]);
// Do poradovníka sa vždy zaradí na koniec, aj keď má niekto v mobile zle nastavené hodiny
const queueTs = (day) => Math.max(Date.now(), ...Object.values(day.waitlist).map((p) => p.ts + 1));
const queue = (day) => Object.entries(day.waitlist).sort((a, b) => a[1].ts - b[1].ts || (a[0] < b[0] ? -1 : 1));

function findMine(day, device) {
  for (const [key, p] of Object.entries(day.seats)) if (p.device === device) return { where: "seat", key, p };
  for (const [key, p] of Object.entries(day.waitlist)) if (p.device === device) return { where: "wait", key, p };
  return null;
}

function removeEntry(day, where, key) {
  delete (where === "seat" ? day.seats : day.waitlist)[key];
}

// Keď sa uvoľní miesto, dostane ho prvý z poradovníka
function promote(day) {
  for (const id of freeSeats(day)) {
    const next = queue(day)[0];
    if (!next) break;
    day.seats[id] = { ...next[1], ts: Date.now() };
    delete day.waitlist[next[0]];
  }
  return day;
}

const ops = {
  take: (seat, me) => (day) => {
    if (day.cancelled) fail(`${CFG.driver} v tento deň nejde.`);
    const taken = day.seats[seat];
    if (taken) fail(taken.device === me.device ? "Na tomto mieste už sedíš." : `Tu už sedí ${taken.name} 😅`);
    const mine = findMine(day, me.device);
    if (!mine && nameTaken(day, me.name)) fail(`Meno „${me.name}“ už je v zozname. Ak to nie si ty, zmeň si meno.`);
    if (mine) removeEntry(day, mine.where, mine.key);
    day.seats[seat] = person(me);
    return promote(day);
  },
  wait: (me) => (day) => {
    if (day.cancelled) fail(`${CFG.driver} v tento deň nejde.`);
    if (findMine(day, me.device)) fail("V zozname už si.");
    if (nameTaken(day, me.name)) fail(`Meno „${me.name}“ už je v zozname. Ak to nie si ty, zmeň si meno.`);
    if (freeSeats(day).length) fail("Ešte je voľné miesto — klikni naň v aute.");
    const p = { ...person(me), ts: queueTs(day) };
    day.waitlist[`w${p.ts}${me.device.slice(0, 6)}`] = p;
    return day;
  },
  leave: (device) => (day) => {
    const mine = findMine(day, device);
    if (!mine) fail("Na tento deň v zozname nie si.");
    removeEntry(day, mine.where, mine.key);
    return promote(day);
  },
  rename: (me) => (day) => {
    const mine = findMine(day, me.device);
    if (!mine) return day;
    if (nameTaken(day, me.name, me.device)) fail(`Meno „${me.name}“ už má niekto iný.`);
    mine.p.name = me.name;
    return day;
  },
  // šofér
  kick: (where, key) => (day) => {
    removeEntry(day, where, key);
    return promote(day);
  },
  seatFor: (name, seat) => (day) => {
    if (nameTaken(day, name)) fail(`${name} už v zozname je.`);
    const p = { name, device: `sofer-${randomId(8)}`, ts: Date.now() };
    const target = seat && !day.seats[seat] ? seat : freeSeats(day)[0];
    if (target) day.seats[target] = p;
    else day.waitlist[`w${(p.ts = queueTs(day))}sofer`] = p;
    return day;
  },
  cancelDay: (on) => (day) => {
    if (on) day.cancelled = true;
    else delete day.cancelled;
    return day;
  },
  note: (text) => (day) => {
    if (text) day.note = text;
    else delete day.note;
    return day;
  },
};

// ---------- úložiská ----------

// Demo: všetko iba v tomto prehliadači
function localStore() {
  const KEY = "faketaxi-demo-days";
  const read = () => { try { return JSON.parse(storage.get(KEY)) || {}; } catch { return {}; } };
  const listeners = [];
  const emit = () => listeners.forEach((l) => l());
  window.addEventListener("storage", (e) => { if (e.key === KEY) emit(); });
  return {
    mode: "local",
    subscribe(fromKey, cb) {
      const l = () => cb(Object.fromEntries(Object.entries(read()).filter(([k]) => k >= fromKey)));
      listeners.push(l);
      l();
    },
    async update(key, fn) {
      const all = read();
      const next = fn(all[key] ?? null);
      if (next === undefined) return false;
      if (next === null) delete all[key];
      else all[key] = next;
      storage.set(KEY, JSON.stringify(all));
      emit();
      return true;
    },
    onConnection(cb) { cb(true); },
  };
}

// Firebase Realtime Database: všetci vidia to isté naživo
async function firebaseStore(conf) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, rtdb] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-database.js`),
  ]);
  const db = rtdb.getDatabase(initializeApp(conf));
  return {
    mode: "firebase",
    subscribe(fromKey, cb, onError) {
      const q = rtdb.query(rtdb.ref(db, "days"), rtdb.orderByKey(), rtdb.startAt(fromKey));
      rtdb.onValue(q, (snap) => cb(snap.val() || {}), onError);
    },
    async update(key, fn) {
      const res = await rtdb.runTransaction(rtdb.ref(db, `days/${key}`), fn);
      return res.committed;
    },
    onConnection(cb) {
      rtdb.onValue(rtdb.ref(db, ".info/connected"), (snap) => cb(snap.val() === true));
    },
  };
}

// ---------- stav ----------

const me = {
  device: storage.get("faketaxi-device") || (() => { const id = randomId(20); storage.set("faketaxi-device", id); return id; })(),
  name: cleanName(storage.get("faketaxi-name")),
};

const state = {
  days: {},
  selected: null,
  ready: false,
  online: true,
  error: null,
  busy: false,
  driver: storage.get("faketaxi-driver") === "1",
};

let store = null;
let lastMine = null;

// Úloha sa zmení v transakcii — tá sa môže zopakovať, ak niekto iný medzitým klikol tiež
async function mutate(k, op, okMsg) {
  if (!store || state.busy) return false;
  state.busy = true;
  let err = null;
  try {
    await store.update(k, (raw) => {
      err = null;
      try {
        return finalize(op(norm(raw)));
      } catch (e) {
        if (!(e instanceof Oops)) throw e;
        err = e;
        // null = „nič nemeň“, ale prinúti Firebase overiť si aktuálne dáta zo servera
        return raw === null ? null : undefined;
      }
    });
  } catch (e) {
    console.error(e);
    toast("Niečo sa pokazilo, skús to znova.", true);
    return false;
  } finally {
    state.busy = false;
  }
  if (err) { toast(err.message, true); return false; }
  if (okMsg) toast(okMsg);
  return true;
}

// Ak sa niekto odhlásil a ja som postúpil z poradovníka na sedadlo, nech o tom viem
function noticePromotions(days) {
  const now = {};
  for (const k of visibleDays(new Date())) now[k] = findMine(norm(days[k]), me.device)?.where || null;
  if (lastMine) {
    for (const k of Object.keys(now)) {
      if (lastMine[k] === "wait" && now[k] === "seat") toast(`🎉 Uvoľnilo sa miesto — ${dayTitle(k).toLowerCase()} ideš!`);
    }
  }
  lastMine = now;
}

// ---------- vykresľovanie ----------

const views = {};
function put(id, html) {
  if (views[id] === html) return;
  views[id] = html;
  document.getElementById(id).innerHTML = html;
}

function render() {
  const now = new Date();
  const list = visibleDays(now);
  if (!list.includes(state.selected)) state.selected = list.find((k) => !isLocked(k, now)) || list[0];
  put("who", renderWho());
  put("banner", renderBanner());
  put("days", list.map((k) => renderChip(k, now)).join(""));
  put("day", renderDay(state.selected, now));
  put("driver", state.driver ? renderDriver(state.selected) : "");
  put("stats", renderStats(now));
}

function renderWho() {
  const dot = store?.mode === "firebase" ? `<i class="net ${state.online ? "on" : ""}" title="${state.online ? "Online" : "Offline"}"></i>` : "";
  return `<button class="who" type="button" data-action="name">${dot}<span>${me.name ? esc(me.name) : "Kto si?"}</span><small>✏️</small></button>`;
}

function renderBanner() {
  if (state.error) return `<div class="banner bad">⚠️ ${esc(state.error)}</div>`;
  if (store?.mode === "local") {
    return `<div class="banner">🧪 <b>Demo režim</b> — rezervácie vidíš iba ty v tomto prehliadači. Aby to videli všetci, treba v <code>config.js</code> nastaviť Firebase (návod je v README).</div>`;
  }
  if (store && !state.online) return `<div class="banner">📴 Si offline — zmeny sa uložia, keď sa znova pripojíš.</div>`;
  return "";
}

function renderChip(k, now) {
  const d = dateOf(k);
  const day = norm(state.days[k]);
  const taken = SEATS.filter((id) => day.seats[id]).length;
  const locked = isLocked(k, now);
  const mine = findMine(day, me.device);
  const today = keyOf(now);
  const label = k === today ? "Dnes" : k === keyOf(addDays(now, 1)) ? "Zajtra" : DAY_SHORT[d.getDay()];
  const free = SEATS.length - taken;
  const status = !state.ready ? "…"
    : day.cancelled ? "nejde sa"
    : locked ? "odišlo"
    : free === 0 ? (Object.keys(day.waitlist).length ? `plné +${Object.keys(day.waitlist).length}` : "plné")
    : `${free} ${plural(free, "voľné", "voľné", "voľných")}`;
  const dots = SEATS.map((id) => `<i class="${day.seats[id] ? (day.seats[id].device === me.device ? "me" : "on") : ""}"></i>`).join("");
  const cls = ["chip", k === state.selected && "sel", day.cancelled && "off", locked && "past", mine && "mine"].filter(Boolean).join(" ");
  return `<button class="${cls}" type="button" data-action="select" data-day="${k}" aria-pressed="${k === state.selected}">
    <span class="chip-day">${label}</span>
    <span class="chip-date">${d.getDate()}. ${d.getMonth() + 1}.</span>
    <span class="dots">${dots}</span>
    <span class="chip-status">${status}</span>
  </button>`;
}

function countdown(k, now) {
  if (isLocked(k, now)) return "už odišlo";
  const days = Math.round((dateOf(k) - dateOf(keyOf(now))) / 864e5);
  if (days === 1) return "zajtra";
  if (days > 1) return `o ${days} ${plural(days, "deň", "dni", "dní")}`;
  const mins = Math.ceil((departureOf(k) - now) / 6e4);
  const h = Math.floor(mins / 60);
  return `o ${h ? `${h} h ` : ""}${mins % 60} min`;
}

function renderDay(k, now) {
  if (!state.ready) return `<div class="loading">Štartujem motor… 🚕</div>`;
  const day = norm(state.days[k]);
  const locked = isLocked(k, now);
  const mine = findMine(day, me.device);
  const waiting = queue(day);
  const free = freeSeats(day).length;

  let status = "";
  if (day.cancelled) {
    status = `<div class="status off">🚫 <b>${esc(CFG.driver)} v tento deň nejde.</b> Treba si nájsť iný spôsob.</div>`;
  } else if (locked) {
    status = `<div class="status">🏁 Auto už odišlo.${mine?.where === "seat" ? " Bol si v ňom 😎" : ""}</div>`;
  } else if (mine?.where === "seat") {
    status = `<div class="status ok">✅ Ideš! Sedíš: <b>${seatLabel(mine.key)}</b>
      <span class="hint">Chceš sa presadiť? Klikni na iné voľné miesto.</span></div>
      <button class="btn danger" type="button" data-action="leave">Zrušiť moju rezerváciu</button>`;
  } else if (mine?.where === "wait") {
    const pos = waiting.findIndex(([key]) => key === mine.key) + 1;
    status = `<div class="status wait">⏳ Si <b>${pos}. v poradovníku</b>.
      <span class="hint">Keď sa niekto odhlási, miesto dostaneš automaticky.</span></div>
      <button class="btn danger" type="button" data-action="leave">Odísť z poradovníka</button>`;
  } else if (free > 0) {
    status = `<div class="status">👉 Klikni na voľné sedadlo a je tvoje.</div>`;
  } else {
    status = `<div class="status">😬 Auto je plné.</div>
      <button class="btn primary" type="button" data-action="wait">Zapísať sa do poradovníka</button>`;
  }

  const queueHtml = waiting.length ? `<div class="queue">
      <h3>Poradovník</h3>
      <ol>${waiting.map(([key, p]) => `<li class="${p.device === me.device ? "me" : ""}">
        <span>${esc(p.name)}${p.device === me.device ? " <em>(ty)</em>" : ""}</span>
        ${state.driver ? `<button class="x" type="button" data-action="kick-wait" data-key="${esc(key)}" aria-label="Vyhodiť ${esc(p.name)}">✕</button>` : ""}
      </li>`).join("")}</ol>
    </div>` : "";

  return `<div class="day-head">
      <div>
        <h2>${dayTitle(k)}</h2>
        <p class="dep">🕖 Odchod <b>${esc(CFG.departure)}</b> · <span>${countdown(k, now)}</span></p>
      </div>
      <button class="btn small ghost" type="button" data-action="share" title="Poslať zoznam do skupiny">📤 Poslať</button>
    </div>
    ${day.note ? `<p class="note">📢 <b>${esc(CFG.driver)}:</b> ${esc(day.note)}</p>` : ""}
    ${renderCar(day, (locked || day.cancelled) && !state.driver)}
    <div class="actions">${status}</div>
    ${queueHtml}`;
}

const WHEEL = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M3.5 10.5h6.3M14.2 10.5h6.3M12 14.2V21"/></svg>`;

function renderSeat(id, day, disabled) {
  const p = day.seats[id];
  const label = seatLabel(id);
  if (!p) {
    return `<button class="seat free" type="button" data-action="seat" data-seat="${id}" ${disabled ? "disabled" : ""} aria-label="${label}: voľné">
      <span class="seat-plus">+</span><span class="seat-name">Voľné</span><span class="seat-label">${seatShort(id)}</span>
    </button>`;
  }
  const mine = p.device === me.device;
  return `<button class="seat taken ${mine ? "mine" : ""}" type="button" data-action="seat" data-seat="${id}" ${disabled ? "disabled" : ""} aria-label="${label}: ${esc(p.name)}">
    <span class="avatar" style="--h:${hueOf(p.name)}">${esc([...p.name][0].toLocaleUpperCase("sk"))}</span>
    <span class="seat-name">${esc(p.name)}</span><span class="seat-label">${mine ? "Ty" : seatShort(id)}</span>
  </button>`;
}

function renderCar(day, disabled) {
  const seat = (id) => renderSeat(id, day, disabled);
  const back = chunk(SEATS.slice(1), 3);
  return `<div class="car ${day.cancelled ? "is-off" : ""}">
    <span class="wheel fl"></span><span class="wheel fr"></span><span class="wheel rl"></span><span class="wheel rr"></span>
    <span class="mirror ml"></span><span class="mirror mr"></span>
    <div class="shell">
      <div class="hood"><span class="light l"></span><span class="light r"></span><span class="hood-band"></span></div>
      <div class="cabin">
        <div class="glass front-glass"></div>
        <div class="row front">
          <div class="seat driver" aria-label="Šofér: ${esc(CFG.driver)}">${WHEEL}<span class="seat-name">${esc(CFG.driver)}</span><span class="seat-label">šofér</span></div>
          <span class="console" aria-hidden="true"></span>
          ${seat(SEATS[0])}
        </div>
        ${back.map((r) => `<div class="row" style="--cols:${r.length}">${r.map(seat).join("")}</div>`).join("")}
        <div class="glass rear-glass"></div>
      </div>
      <div class="trunk"><span class="plate">KUČERA</span></div>
    </div>
  </div>`;
}

function renderDriver(k) {
  const day = norm(state.days[k]);
  return `<section class="card driver-card">
    <div class="card-head">
      <h3>🔑 Panel šoféra</h3>
      <button class="link" type="button" data-action="driver-logout">Odhlásiť</button>
    </div>
    <p class="muted">Upravuješ <b>${dayTitle(k).toLowerCase()}</b>. Klik na obsadené sedadlo = vyhodiť, na voľné = niekoho posadiť.</p>
    <button class="btn ${day.cancelled ? "primary" : "danger"} wide" type="button" data-action="toggle-cancel">
      ${day.cancelled ? "✅ Predsa idem — obnoviť jazdu" : "🚫 V tento deň nejdem"}
    </button>
    <form class="inline" data-form="note">
      <input name="note" maxlength="140" placeholder="Odkaz, napr. dnes o 7:10 pred bránou" value="${esc(day.note || "")}">
      <button class="btn" type="submit">Uložiť</button>
    </form>
    <form class="inline" data-form="add">
      <input name="name" maxlength="24" placeholder="Meno pasažiera bez mobilu" required>
      <button class="btn" type="submit">Posadiť</button>
    </form>
  </section>`;
}

function renderStats(now) {
  const today = keyOf(now);
  const from = keyOf(addDays(now, -CFG.statsDays));
  const counts = new Map();
  for (const [k, day] of Object.entries(state.days)) {
    if (k < from || k > today || day.cancelled || (k === today && !isLocked(k, now))) continue;
    for (const id of SEATS) {
      const p = day.seats?.[id];
      if (!p) continue;
      const key = p.name.trim().toLocaleLowerCase("sk");
      const e = counts.get(key) || { name: p.name, n: 0 };
      e.n++;
      counts.set(key, e);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "sk")).slice(0, 8);
  const max = top[0]?.n || 1;
  const medal = ["🥇", "🥈", "🥉"];
  const body = top.length
    ? `<ol class="board">${top.map((e, i) => `<li>
        <span class="rank">${medal[i] || `${i + 1}.`}</span>
        <span class="who-name">${esc(e.name)}</span>
        <span class="bar"><i style="width:${Math.max(6, Math.round((e.n / max) * 100))}%"></i></span>
        <span class="count">${e.n} ${plural(e.n, "jazda", "jazdy", "jázd")}</span>
      </li>`).join("")}</ol>`
    : `<p class="muted">Zatiaľ žiadne jazdy. Prvý pasažier bude zapísaný v histórii navždy. 🏆</p>`;
  return `<h3>🏆 Najvernejší pasažieri <small>· ${CFG.statsDays} dní</small></h3>${body}`;
}

// ---------- drobnosti ----------

let toastTimer;
function toast(msg, bad = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `show ${bad ? "bad" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 3200);
}

function askName() {
  const dlg = document.getElementById("nameDialog");
  const input = dlg.querySelector("input");
  if (dlg.open) return new Promise((resolve) => dlg.addEventListener("close", () => resolve(Boolean(me.name)), { once: true }));
  input.value = me.name;
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener("close", async () => {
      const name = cleanName(input.value);
      if (dlg.returnValue !== "ok" || !name) return resolve(Boolean(me.name));
      const old = me.name;
      me.name = name;
      storage.set("faketaxi-name", name);
      render();
      if (old && old !== name) {
        // premenuj ma aj v rezerváciách, ktoré ešte len budú
        const now = new Date();
        for (const k of visibleDays(now)) {
          if (!isLocked(k, now) && findMine(norm(state.days[k]), me.device)) await mutate(k, ops.rename({ ...me }));
        }
      }
      resolve(true);
    }, { once: true });
  });
}

async function ensureName() {
  return me.name ? true : askName();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function driverLogin() {
  const dlg = document.getElementById("pinDialog");
  const input = dlg.querySelector("input");
  const error = dlg.querySelector(".dialog-error");
  input.value = "";
  error.hidden = true;
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue !== "ok") return;
    let ok = false;
    try { ok = (await sha256(input.value.trim())) === String(CFG.driverPinHash).toLowerCase(); } catch { /* bez crypto.subtle (http) */ }
    if (!ok) {
      input.value = "";
      error.hidden = false;
      dlg.showModal();
      return;
    }
    state.driver = true;
    storage.set("faketaxi-driver", "1");
    render();
    toast(`Vitaj za volantom, ${CFG.driver} 🚕`);
  };
}

function shareText(k) {
  const day = norm(state.days[k]);
  const lines = [`🚕 FakeTaxi Kučera — ${dayTitle(k).toLowerCase()}`];
  if (day.cancelled) {
    lines.push(`🚫 ${CFG.driver} v tento deň nejde.`);
  } else {
    lines.push(`🕖 Odchod ${CFG.departure}`);
    if (day.note) lines.push(`📢 ${day.note}`);
    SEATS.forEach((id) => lines.push(`${seatLabel(id)}: ${day.seats[id]?.name || "— voľné —"}`));
    const waiting = queue(day);
    if (waiting.length) lines.push(`Poradovník: ${waiting.map(([, p]) => p.name).join(", ")}`);
  }
  lines.push(`👉 ${location.origin}${location.pathname}`);
  return lines.join("\n");
}

async function share(k) {
  const text = shareText(k);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Skopírované — vlož to do skupiny 📋");
  } catch {
    window.prompt("Skopíruj si to:", text);
  }
}

// ---------- udalosti ----------

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const k = state.selected;
  const day = norm(state.days[k]);

  switch (el.dataset.action) {
    case "select":
      state.selected = el.dataset.day;
      render();
      break;

    case "name":
      askName();
      break;

    case "seat": {
      const id = el.dataset.seat;
      const p = day.seats[id];
      if (state.driver) {
        if (p) {
          if (confirm(`Vyhodiť ${p.name} z auta?`)) mutate(k, ops.kick("seat", id), `${p.name} je vonku.`);
        } else {
          const name = cleanName(prompt(`Koho posadiť na miesto „${seatLabel(id)}“?`));
          if (name) mutate(k, ops.seatFor(name, id), `${name} sedí.`);
        }
        break;
      }
      if (p) {
        toast(p.device === me.device ? "Toto je tvoje miesto 😎" : `Tu sedí ${p.name}.`);
        break;
      }
      if (!(await ensureName())) break;
      const moving = findMine(day, me.device)?.where === "seat";
      mutate(k, ops.take(id, { ...me }), moving ? "Presadené 👍" : "Miesto je tvoje! 🚕");
      break;
    }

    case "wait":
      if (await ensureName()) mutate(k, ops.wait({ ...me }), "Si v poradovníku ⏳");
      break;

    case "leave":
      if (confirm("Naozaj zrušiť? Miesto môže hneď niekto zobrať.")) mutate(k, ops.leave(me.device), "Zrušené.");
      break;

    case "kick-wait": {
      const p = day.waitlist[el.dataset.key];
      if (p && confirm(`Vyhodiť ${p.name} z poradovníka?`)) mutate(k, ops.kick("wait", el.dataset.key));
      break;
    }

    case "toggle-cancel":
      if (day.cancelled) mutate(k, ops.cancelDay(false), "Jazda je späť ✅");
      else if (confirm(`Zrušiť jazdu — ${dayTitle(k).toLowerCase()}? Rezervácie ostanú, keby si si to rozmyslel.`)) mutate(k, ops.cancelDay(true), "Jazda zrušená.");
      break;

    case "share":
      share(k);
      break;

    case "driver-login":
      if (state.driver) toast("Režim šoféra už je zapnutý.");
      else driverLogin();
      break;

    case "driver-logout":
      state.driver = false;
      storage.del("faketaxi-driver");
      render();
      break;
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const k = state.selected;
  if (form.dataset.form === "note") {
    const text = clip(form.querySelector("input").value, 140);
    mutate(k, ops.note(text), text ? "Odkaz uložený 📢" : "Odkaz zmazaný.");
  } else if (form.dataset.form === "add") {
    const name = cleanName(form.querySelector("input").value);
    if (name) mutate(k, ops.seatFor(name), `${name} je v zozname.`).then((ok) => ok && form.reset());
  }
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
setInterval(render, 20000);

// ---------- štart ----------

(async function start() {
  render();
  try {
    store = CFG.firebase ? await firebaseStore(CFG.firebase) : localStore();
  } catch (e) {
    console.error(e);
    state.error = "Nepodarilo sa pripojiť k databáze. Skontroluj internet a nastavenie Firebase v config.js.";
    render();
    return;
  }
  // .info/connected je na začiatku chvíľu false — offline hlásime až keď to trvá
  let offTimer;
  store.onConnection((on) => {
    clearTimeout(offTimer);
    if (on) { state.online = true; render(); }
    else offTimer = setTimeout(() => { state.online = false; render(); }, 3000);
  });
  store.subscribe(
    keyOf(addDays(new Date(), -CFG.statsDays)),
    (days) => {
      noticePromotions(days);
      state.days = days;
      state.ready = true;
      state.error = null;
      render();
    },
    (err) => {
      console.error(err);
      state.error = "Databáza odmietla prístup — skontroluj pravidlá vo Firebase (README, krok 3).";
      render();
    },
  );
  if (!me.name) askName();
})();
