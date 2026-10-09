import { firebaseConfig, apkUrl } from "./firebase-config.js";
import { STRINGS } from "./i18n.js";
import { qrSvg, qrMatrix } from "./qr.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc as fsDoc, collection as fsCollection, getDoc, setDoc, addDoc, deleteDoc,
  onSnapshot as fsOnSnapshot, query, limit as fsLimit, orderBy as fsOrderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =====================================================================
   Study Duel — installable app. Invite-only parties (QR / link), host-only controls,
   English + Egyptian Arabic.
   ===================================================================== */

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

/* ---------- i18n ---------- */
const LS = {
  get(k) { try { return localStorage.getItem("studyduel." + k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem("studyduel." + k) : localStorage.setItem("studyduel." + k, v); } catch (e) {} }
};
let LANG = (() => {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "ar" || q === "en") { LS.set("lang", q); return q; }
  const saved = LS.get("lang");
  if (saved === "ar" || saved === "en") return saved;
  return (navigator.language || "en").toLowerCase().startsWith("ar") ? "ar" : "en";
})();
const t = (k, v) => {
  let s = STRINGS[LANG][k];
  if (s === undefined) s = STRINGS.en[k];
  if (s === undefined) return k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.split("{" + a + "}").join(b);
  return s;
};
const LOCALE = () => LANG === "ar" ? "ar-EG-u-nu-latn" : undefined;
const daysTxt = n => {
  const key = n === 1 ? "d.1" : (LANG === "ar" && n === 2) ? "d.2" : (LANG === "ar" && n >= 3 && n <= 10) ? "d.few" : "d.n";
  return t(key, { n });
};
const defaultRewards = () => STRINGS[LANG].rewards_default;
const defaultPunish = () => STRINGS[LANG].punish_default;

const pad = n => String(n).padStart(2, "0");
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return dstr(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const niceDay = s => parse(s).toLocaleDateString(LOCALE(), { weekday: "short", month: "short", day: "numeric" });
const mins = m => m >= 60 ? `${Math.floor(m / 60)}${t("u.h")}${m % 60 ? " " + (m % 60) + t("u.m") : ""}` : `${m}${t("u.m")}`;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const joinNames = names => names.length <= 1 ? (names[0] || "") : names.slice(0, -1).join(", ") + t("and") + names[names.length - 1];
const cardTitle = (icon, text, right) => h("div", { class: "ct" }, h("span", { class: "ci", text: icon }), h("span", { text }), right ? h("span", { class: "r", text: right }) : null);

const GOAL_BONUS = 10, DONE_BONUS = 10, MAX_PLAYERS = 8;
const COLORS = ["#7c5cff", "#ff7a45", "#18a874", "#e5484d", "#f5b301", "#2f9bff", "#d65db1", "#6b7280"];
const AVATARS = ["🦊", "🐼", "🐯", "🦄", "🐲", "🤖", "👾", "🧙"];
const MEDALS = ["🥇", "🥈", "🥉"];

/* ---------- state ---------- */
const S = {
  db: null, myId: null, party: null, info: null, pending: null, kicked: false, authError: false,
  players: {}, logs: [], settings: null, result: null, chat: [], chatTo: null, seenMem: 0,
  tab: "home", loaded: { players: false, logs: false, settings: false, result: false, info: false, chat: false },
  animatedTs: null, avatar: AVATARS[0], confirm: {}, lastPts: {}, lastLvl: {}, gateKey: null, mainShown: false,
  installEvt: null
};
const configured = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("PASTE"));
const isSolo = () => !!(S.info && S.info.mode === "solo");

/* ---------- ui bits ---------- */
let toastT, introT, gateT;
function toast(msg) {
  document.querySelectorAll(".toast").forEach(x => x.remove());
  const el = h("div", { class: "toast", text: msg });
  document.body.append(el);
  clearTimeout(toastT);
  toastT = setTimeout(() => el.remove(), 3200);
}
function burst(fromEl, emojis) {
  const r = fromEl.getBoundingClientRect();
  for (let i = 0; i < 16; i++) {
    const p = h("div", { class: "pop", text: emojis[i % emojis.length] });
    p.style.left = r.left + r.width / 2 + "px";
    p.style.top = r.top + Math.min(r.height / 2, 80) + "px";
    p.style.setProperty("--dx", (Math.random() * 280 - 140) + "px");
    p.style.setProperty("--dy", (-60 - Math.random() * 180) + "px");
    document.body.append(p);
    setTimeout(() => p.remove(), 1200);
  }
}
function flyPoints(fromEl, pts) {
  const r = fromEl.getBoundingClientRect();
  const f = h("div", { class: "fly", text: `+${pts} ⭐` });
  f.style.left = r.left + r.width / 2 + "px";
  f.style.top = r.top + "px";
  document.body.append(f);
  setTimeout(() => f.remove(), 1300);
}
function playIntro() {
  document.body.classList.remove("intro");
  void document.body.offsetWidth;
  document.body.classList.add("intro");
  clearTimeout(introT);
  introT = setTimeout(() => document.body.classList.remove("intro"), 1500);
}
function countUp(el, from, to) {
  const t0 = performance.now(), d = 800;
  const step = now => {
    const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function numEl(uid, value, cls) {
  const el = h("div", { class: cls, text: value });
  let prev = S.lastPts[uid];
  if (prev === undefined && document.body.classList.contains("intro")) prev = 0;
  if (prev !== undefined && prev !== value) {
    el.textContent = prev;
    countUp(el, prev, value);
    if (value > prev) el.classList.add("bump");
  }
  S.lastPts[uid] = value;
  return el;
}
async function safe(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && e.code === "permission-denied") toast(t("err.perm"));
    else if (e && e.code === "resource-exhausted") toast(t("err.quota"));
    else toast(t("err.generic"));
    return undefined;
  }
}
const hostOnly = () => { if (isHost()) return true; toast(t("only.host")); return false; };

/* ---------- Firestore wrapper (small, promise-based) ---------- */
const snapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data() });
function makeDB(f) {
  return {
    doc(path) {
      const ref = fsDoc(f, path);
      return {
        set: d => setDoc(ref, d),
        get: async () => snapDoc(await getDoc(ref)),
        delete: () => deleteDoc(ref),
        onSnapshot: (next, err) => fsOnSnapshot(ref, s => next(snapDoc(s)), err)
      };
    },
    collection(path) {
      const ref = fsCollection(f, path);
      const mk = q => ({
        limit: n => mk(query(q, fsLimit(n))),
        orderBy: (field, dir) => mk(query(q, fsOrderBy(field, dir || "asc"))),
        onSnapshot: (next, err) => fsOnSnapshot(q, s => next({
          docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })),
          docChanges: () => s.docChanges().map(c => ({ type: c.type, doc: { id: c.doc.id, data: () => c.doc.data() } }))
        }), err)
      });
      return Object.assign(mk(ref), { add: d => addDoc(ref, d) });
    }
  };
}

/* ---------- game logic ---------- */
function contestants() {
  return Object.entries(S.players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_PLAYERS);
}
const hostId = () => (S.info && S.info.owner) || (contestants()[0] && contestants()[0].id) || null;
const isHost = () => !!S.myId && hostId() === S.myId;
const colorOf = uid => { const i = contestants().findIndex(c => c.id === uid); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const logPoints = (minutes, mult, done) => Math.round(minutes / 5 * mult) + (done ? DONE_BONUS : 0);
const levelOf = total => Math.floor(total / 50) + 1;
function stats(uid) {
  const st = S.settings;
  const ls = S.logs.filter(l => l.uid === uid && l.day >= st.start && l.day <= st.end);
  const byDay = {};
  ls.forEach(l => byDay[l.day] = (byDay[l.day] || 0) + l.minutes);
  const days = Object.keys(byDay).sort();
  const base = ls.reduce((a, l) => a + l.points, 0);
  let goalB = 0, streakB = 0, streak = 0, best = 0, prev = null;
  days.forEach(d => {
    streak = prev && diffDays(prev, d) === 1 ? streak + 1 : 1;
    best = Math.max(best, streak);
    if (byDay[d] >= st.goal) goalB += GOAL_BONUS;
    if (streak >= 2) streakB += 3 * Math.min(streak - 1, 5);
    prev = d;
  });
  const last = days[days.length - 1];
  const cur = last && diffDays(last, today()) <= 1 ? streak : 0;
  const subjects = {};
  ls.forEach(l => { const k = (l.subject || "?").trim(); subjects[k] = (subjects[k] || 0) + l.minutes; });
  return {
    ls, byDay, days, base, goalB, streakB, total: base + goalB + streakB, cur, best, subjects,
    minutes: ls.reduce((a, l) => a + l.minutes, 0),
    maxSession: ls.reduce((a, l) => Math.max(a, l.minutes), 0)
  };
}
function badgesFor(uid, st) {
  const out = [];
  const all = S.logs.filter(l => l.day >= S.settings.start && l.day <= S.settings.end);
  if (!isSolo() && all.length) {
    const first = all.reduce((a, l) => (l.ts < a.ts ? l : a), all[0]);
    if (first.uid === uid) out.push(t("badge.first"));
  }
  if (st.best >= 3) out.push(t("badge.fire"));
  if (st.maxSession >= 120) out.push(t("badge.marathon"));
  if (st.goalB >= GOAL_BONUS * 3) out.push(t("badge.goal"));
  if (Object.keys(st.subjects).length >= 3) out.push(t("badge.poly"));
  return out;
}
const isEnded = () => S.settings && today() > S.settings.end;
const daysLeft = () => S.settings ? Math.max(0, diffDays(today(), S.settings.end) + 1) : 0;
const currentResult = () => S.result && S.settings && S.result.round === S.settings.round ? S.result : null;
const playerName = id => (S.players[id] && S.players[id].nick) || "—";
const playerAv = id => (S.players[id] && S.players[id].avatar) || "🙂";
const standings = () => contestants().map(c => ({ id: c.id, total: stats(c.id).total })).sort((a, b) => b.total - a.total);
function groupTie() {
  const s = standings();
  if (s.length < 2) return false;
  return s[0].total === s[s.length - 1].total || s.filter(x => x.total === s[0].total).length > 1;
}

/* ---------- ids / links ---------- */
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const KEYCHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const randChars = (chars, n) => {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, x => chars[x % chars.length]).join("");
};
const genCode = () => randChars(ALPHA, 6);
const genKey = () => randChars(KEYCHARS, 16);
const genJoinCode = () => randChars(ALPHA, 8);
const cleanCode = x => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const fmtCode = c => (c && c.length === 8) ? `${c.slice(0, 4)}-${c.slice(4)}` : (c || "");
const BASE = () => location.origin + location.pathname.replace(/[^/]*$/, "");
const inviteLink = () => `${BASE()}?join=${S.party}.${S.info.key}`;
const appLink = () => (apkUrl && apkUrl.trim()) || BASE();

/* ---------- db writes (the Firestore rules enforce host-only + invite-only) ---------- */
const P = p => "parties/" + S.party + "/" + p;
const pool = key => (S.settings && S.settings[key] && S.settings[key].length ? S.settings[key] : (key === "rewards" ? defaultRewards() : defaultPunish()));

async function saveSettings(patch) {
  if (!hostOnly()) return;
  const next = Object.assign({}, S.settings, patch);
  return safe(() => S.db.doc(P("meta/settings")).set(next));
}
async function startChallenge(duration, goal, target) {
  if (!hostOnly()) return;
  const tt = today();
  const data = { round: 1, start: tt, end: addDays(tt, duration - 1), duration, goal, rewards: defaultRewards().slice(), punishments: defaultPunish().slice() };
  if (isSolo()) data.target = target;
  return safe(() => S.db.doc(P("meta/settings")).set(data));
}
const addLog = entry => safe(() => S.db.collection(P("logs")).add(entry));
const removeMember = async id => { if (hostOnly()) await safe(() => S.db.doc(P("players/" + id)).delete()); };
async function revealResult() {
  if (!hostOnly()) return;
  const cs = contestants();
  const rw = pool("rewards"), pu = pool("punishments");
  let data;
  if (isSolo()) {
    const me = cs[0];
    if (!me) return;
    const score = stats(me.id).total;
    const hit = score >= S.settings.target;
    data = { round: S.settings.round, solo: true, hit, score, target: S.settings.target, reward: hit ? pick(rw) : null, punishment: hit ? null : pick(pu), ts: Date.now() };
  } else {
    if (cs.length < 2) { toast(t("result.need2")); return; }
    if (groupTie()) { toast(t("result.tietoast")); return; }
    const board = standings();
    const low = board[board.length - 1].total;
    data = {
      round: S.settings.round, solo: false, winner: board[0].id, losers: board.filter(x => x.total === low).map(x => x.id),
      reward: pick(rw), punishment: pick(pu), scoreW: board[0].total, scoreL: low, board, ts: Date.now()
    };
  }
  await safe(() => S.db.doc(P("meta/result")).set(data));
}
async function newRound() {
  if (!hostOnly()) return;
  const dur = S.settings.duration || 7, tt = today();
  await saveSettings({ round: (S.settings.round || 1) + 1, start: tt, end: addDays(tt, dur - 1) });
  await safe(() => S.db.doc(P("meta/result")).delete());
}
async function publishJoinCode(key) {
  for (let i = 0; i < 4; i++) {
    const jc = genJoinCode();
    if (await tryDo(() => S.db.doc("joinCodes/" + jc).set({ party: S.party, key, owner: S.myId }))) return jc;
  }
  return null;
}
async function ensureJoinCode() {
  if (!isHost() || isSolo() || !S.info || !S.info.key) return false;
  const jc = await publishJoinCode(S.info.key);
  if (!jc) return false;
  await safe(() => S.db.doc("parties/" + S.party).set({ ...S.info, joinCode: jc }));
  return true;
}
async function rotateInvite() {
  if (!hostOnly()) return;
  const base = { ...S.info }, oldJc = base.joinCode, key = genKey();
  if (!(await tryDo(() => S.db.doc("parties/" + S.party).set({ ...base, key })))) { toast(t("err.generic")); return; }
  const jc = await publishJoinCode(key);
  await tryDo(() => S.db.doc("parties/" + S.party).set({ ...base, key, joinCode: jc }));
  if (oldJc) await tryDo(() => S.db.doc("joinCodes/" + oldJc).delete());
  toast(t("invite.new.done"));
}

/* ---------- theme (light / dark / follow phone) ---------- */
function effectiveTheme() {
  const th = LS.get("theme");
  if (th === "light" || th === "dark") return th;
  return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme() {
  const th = LS.get("theme");
  const root = document.documentElement;
  if (th === "light" || th === "dark") root.dataset.theme = th; else delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", effectiveTheme() === "dark" ? "#12111b" : "#7c5cff");
}
function toggleTheme() {
  LS.set("theme", effectiveTheme() === "dark" ? "light" : "dark");
  applyTheme();
  renderChips();
}
if (window.matchMedia) {
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { applyTheme(); renderChips(); }); } catch (e) {}
}

/* ---------- header chips ---------- */
function renderChips() {
  const c = $("#chips");
  c.replaceChildren();
  c.append(h("div", { class: "chip link", onclick: toggleLang }, h("b", { text: "🌐 " + t("lang.switch") })));
  c.append(h("div", { class: "chip link", title: t("theme.toggle"), onclick: toggleTheme }, h("b", { text: effectiveTheme() === "dark" ? "☀️" : "🌙" })));
  if (S.party && S.info) {
    if (isSolo()) c.append(h("div", { class: "chip" }, h("b", { text: t("chip.solo") })));
    else c.append(h("div", { class: "chip" }, "👥 ", h("b", { text: `${Object.keys(S.players).length}/${MAX_PLAYERS}` })));
  }
  if (!S.settings) return;
  if (isEnded()) c.append(h("div", { class: "chip" }, h("b", { text: t("chip.timeup") })));
  else c.append(h("div", { class: "chip" }, h("b", { text: t("chip.left", { d: daysTxt(daysLeft()) }) })));
}

/* ---------- install banner ---------- */
const isStandalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
function renderInstall() {
  const box = $("#install");
  box.replaceChildren();
  if (isStandalone() || LS.get("nobanner") === "1") return;
  const ua = navigator.userAgent || "";
  const android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua);
  const hasApk = !!(apkUrl && apkUrl.trim());
  if (!(hasApk && android) && !S.installEvt && !ios) return;
  const row = h("div", { class: "banner" }, h("span", { class: "grow", text: ios ? t("banner.ios") : t("banner.text") }));
  if (android && hasApk) row.append(h("a", { class: "btn", href: apkUrl, download: "", text: t("banner.apk") }));
  if (S.installEvt) row.append(h("button", { class: "btn", text: t("banner.install"), onclick: async () => { const e = S.installEvt; S.installEvt = null; renderInstall(); try { await e.prompt(); } catch (x) {} } }));
  row.append(h("button", { class: "x", text: "✕", onclick: () => { LS.set("nobanner", "1"); renderInstall(); } }));
  box.append(row);
}

/* ---------- gate (everything before the main app) ---------- */
function gateScreen() {
  if (!configured) return "needsetup";
  if (S.authError) return "autherr";
  if (!S.db || !S.myId) return "loading";
  if (S.kicked) return "kicked";
  if (S.pending && !S.party) return "profile";
  if (!S.party) return "mode";
  if (!Object.values(S.loaded).every(Boolean)) return "loading";
  if (!S.info || !S.players[S.myId]) return "kicked";
  if (contestants().findIndex(c => c.id === S.myId) < 0) return "full";
  if (!S.settings) return isHost() ? "setup" : "wait";
  return "main";
}
const infoCard = (emoji, title, text, ...extra) => h("div", { class: "card center" },
  h("div", { class: "big float", text: emoji }), h("h3", { text: title }),
  text ? h("div", { class: "muted", style: "margin-top:6px", text }) : null, ...extra);

function renderGate() {
  const g = $("#gate"), main = $("#main");
  const key = gateScreen();
  const showMain = key === "main";
  main.hidden = !showMain;
  $("#tabs").hidden = !showMain;
  if (showMain) { g.replaceChildren(); S.gateKey = "main"; return; }
  if (key === S.gateKey && g.contains(document.activeElement)) return;
  const changed = key !== S.gateKey;
  S.gateKey = key;
  g.replaceChildren();
  if (changed) { g.classList.add("fresh"); clearTimeout(gateT); gateT = setTimeout(() => g.classList.remove("fresh"), 900); }

  if (key === "needsetup") { g.append(infoCard("🔧", t("setup.needed.title"), t("setup.needed.text"))); return; }
  if (key === "autherr") { g.append(infoCard("📡", t("autherr.title"), t("autherr.text"), h("button", { class: "btn", text: t("retry"), onclick: () => location.reload() }))); return; }
  if (key === "loading") { g.append(infoCard("⚔️", t("loading"))); return; }
  if (key === "kicked") { g.append(infoCard("🚪", t("kicked.title"), t("kicked.text"), h("button", { class: "btn", text: t("ok"), onclick: () => leaveLocal() }))); return; }
  if (key === "full") { g.append(infoCard("😬", t("full.title"), t("full.text"), h("button", { class: "btn ghost", text: t("leave.party"), onclick: () => leaveParty() }))); return; }

  if (key === "mode") {
    const code = h("input", { class: "codein", maxlength: "9", placeholder: "ABCD-EFGH", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
    code.addEventListener("input", () => { const c = cleanCode(code.value).slice(0, 8); code.value = c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c; });
    code.addEventListener("keydown", e => { if (e.key === "Enter") joinWithCode(code.value); });
    const step = (n, icon, label) => h("div", { class: "step" }, h("i", { text: icon }), h("b", { text: String(n) }), label);
    g.append(
      h("div", { class: "landing" },
        h("div", { class: "orb o1" }), h("div", { class: "orb o2" }),
        h("div", { class: "orbit" }, ...AVATARS.slice(0, 5).map((a, i) => h("span", { style: `--i:${i};--s:${[1, 3, 5, 3, 1][i]}`, text: a }))),
        h("h1", { class: "ltitle", text: t("mode.title") }),
        h("p", { class: "lsub", text: t("mode.sub") }),
        h("div", { class: "steps" }, step(1, "📝", t("mode.step1")), step(2, "⭐", t("mode.step2")), step(3, "🎁", t("mode.step3"))),
        h("div", { class: "feats" }, h("span", { text: t("mode.f1") }), h("span", { text: t("mode.f2") }), h("span", { text: t("mode.f3") }))),
      h("div", { class: "choices" },
        h("div", { class: "choice primary" },
          h("div", { class: "cic", text: "👥" }),
          h("div", { class: "cbody" }, h("h3", { text: t("group.title") }),
            h("div", { class: "muted", style: "margin-top:4px", text: t("group.desc", { n: MAX_PLAYERS - 1 }) }),
            h("button", { class: "btn", text: t("group.btn"), onclick: () => startProfile("group") }))),
        h("div", { class: "choice" },
          h("div", { class: "cic", text: "🧍" }),
          h("div", { class: "cbody" }, h("h3", { text: t("solo.title") }),
            h("div", { class: "muted", style: "margin-top:4px", text: t("solo.desc") }),
            h("button", { class: "btn ghost", text: t("solo.btn"), onclick: () => startProfile("solo") }))),
        h("div", { class: "choice" },
          h("div", { class: "cic", text: "🔑" }),
          h("div", { class: "cbody" }, h("h3", { text: t("code.title") }),
            h("div", { class: "muted", style: "margin:4px 0 10px", text: t("code.desc") }),
            code,
            h("button", { class: "btn ghost", text: t("code.btn"), onclick: () => joinWithCode(code.value) })))));
    return;
  }

  if (key === "profile") {
    const pd = S.pending;
    const nick = h("input", { maxlength: "20", placeholder: t("nick.ph"), value: LS.get("nick") || "" });
    const pickEl = h("div", { class: "avpick" });
    const draw = () => pickEl.replaceChildren(...AVATARS.map(a => h("button", {
      class: a === S.avatar ? "on" : "", type: "button", text: a, onclick: () => { S.avatar = a; draw(); }
    })));
    draw();
    const T = pd.type === "join" ? "join" : pd.type === "solo" ? "solo" : "create";
    const submit = h("button", { class: "btn", text: t("enter") });
    submit.addEventListener("click", async () => {
      const n = nick.value.trim();
      if (!n) { nick.classList.add("shake"); nick.focus(); setTimeout(() => nick.classList.remove("shake"), 400); return; }
      submit.disabled = true;
      await submitProfile(n, S.avatar);
      submit.disabled = false;
    });
    g.append(h("div", { class: "card" },
      cardTitle("🥊", t(`profile.${T}.title`)),
      h("div", { class: "muted", style: "margin-top:-6px", text: t(`profile.${T}.sub`) }),
      h("label", { text: t("nick.label") }), nick,
      h("label", { text: t("avatar.label") }), pickEl,
      submit,
      h("button", { class: "btn ghost", text: t("back"), onclick: () => { S.pending = null; renderAll(); } })));
    return;
  }

  if (key === "wait") {
    g.append(infoCard("⏳", t("wait.title"), t("wait.text", { host: playerName(hostId()) }),
      h("div", { class: "avrow" }, ...contestants().map(c => h("span", { title: c.nick, text: c.avatar }))),
      h("button", { class: "btn ghost", text: t("leave.party"), onclick: () => leaveParty() })));
    return;
  }

  if (key === "setup") {
    const dur = h("input", { type: "number", min: "1", max: "60", value: "7" });
    const goal = h("input", { type: "number", min: "15", max: "600", step: "15", value: "90" });
    const target = h("input", { type: "number", min: "10", max: "5000", step: "10", value: "250" });
    g.append(h("div", { class: "card" },
      cardTitle("⚙️", isSolo() ? t("setup.title.solo") : t("setup.title.group"), isSolo() ? "" : t("hostctl")),
      h("label", { text: t("setup.days"), style: "margin-top:0" }), dur,
      h("label", { text: t("setup.goal") }), goal,
      ...(isSolo() ? [h("label", { text: t("setup.target") }), target, h("div", { class: "muted small", style: "margin-top:6px", text: t("setup.hint") })] : []),
      h("div", { class: "muted small", style: "margin-top:10px", text: t("setup.later") }),
      h("button", { class: "btn", text: t("setup.start"), onclick: () => startChallenge(Math.max(1, +dur.value || 7), Math.max(15, +goal.value || 90), Math.max(10, +target.value || 250)) })));
  }
}

/* ---------- arena (home) ---------- */
function checkLevelUp(cs, st) {
  cs.forEach((c, i) => {
    const lvl = levelOf(st[i].total), prev = S.lastLvl[c.id];
    S.lastLvl[c.id] = lvl;
    if (c.id === S.myId && prev !== undefined && lvl > prev) {
      toast(t("lvlup", { n: lvl }));
      setTimeout(() => burst($("#vsCard"), ["🎉", "⭐", "✨", "🚀"]), 150);
    }
  });
}
function playerCard(c, s, color, lead) {
  return h("div", { class: `pl${lead ? " lead" : ""}`, style: `--pc:${color}` },
    h("div", { class: "av", text: c.avatar }),
    h("div", { class: "nm", text: c.nick + (c.id === S.myId ? " " + t("arena.you") : "") }),
    numEl(c.id, s.total, "pts"),
    h("div", { class: "lvl" }, h("span", { class: "flame", text: "🔥" }), " ", t("arena.level", { n: levelOf(s.total), s: s.cur })),
    h("div", { class: "xp" }, h("i", { style: `width:${(s.total % 50) * 2}%` })),
    h("div", { class: "badges" }, badgesFor(c.id, s).map(b => h("span", { class: "badge", text: b }))));
}
function renderVS() {
  const box = $("#vsCard");
  box.replaceChildren();
  if (!S.settings) return;
  const cs = contestants();
  const st = cs.map(c => stats(c.id));
  checkLevelUp(cs, st);

  if (isSolo()) {
    if (!cs.length) return;
    const s = st[0], target = S.settings.target || 250;
    const pct = Math.min(100, (s.total / target) * 100);
    box.append(
      playerCard(cs[0], s, COLORS[0], s.total >= target),
      h("div", { style: "margin-top:16px" },
        h("div", { class: "tuglabel" }, h("span", { text: t("arena.target") }),
          h("span", { text: s.total >= target ? t("arena.hit", { a: s.total, b: target }) : t("arena.togo", { a: s.total, b: target, x: target - s.total }) })),
        h("div", { class: "tug" }, h("i", { style: `width:${pct}%;background:${COLORS[0]}` }))));
    return;
  }

  const hint = isHost() && cs.length < MAX_PLAYERS ? h("div", { class: "invite" }, h("span", { text: t("arena.invite") })) : null;

  if (cs.length >= 3) {
    const rows = cs.map((c, i) => ({ c, s: st[i], i })).sort((x, y) => y.s.total - x.s.total);
    const max = Math.max(1, ...rows.map(r => r.s.total));
    box.append(cardTitle("🏁", t("arena.board"), t("arena.players", { n: cs.length })));
    rows.forEach((r, k) => {
      const mini = numEl(r.c.id, r.s.total, "ptsmini");
      mini.style.cssText = "flex:none;font-weight:900;font-size:18px";
      box.append(h("div", { class: `lb${r.c.id === S.myId ? " me" : ""}` },
        h("div", { class: "rk", text: MEDALS[k] || `#${k + 1}` }),
        h("div", { class: "lbm" },
          h("div", { class: "row", style: "justify-content:space-between;align-items:center" },
            h("span", { style: "font-weight:800", text: `${r.c.avatar} ${r.c.nick}${r.c.id === S.myId ? " " + t("arena.you") : ""}` }), mini),
          h("div", { class: "bar" }, h("i", { style: `width:${(r.s.total / max) * 100}%;background:${COLORS[r.i % COLORS.length]}` })),
          h("div", { class: "s" }, h("span", { class: "flame", text: "🔥" }), " ", t("arena.level.short", { n: levelOf(r.s.total), s: r.s.cur, m: mins(r.s.minutes) })),
          h("div", { class: "badges" }, badgesFor(r.c.id, r.s).map(b => h("span", { class: "badge", text: b }))))));
    });
    if (hint) box.append(hint);
    return;
  }

  const tot = st.map(s => s.total);
  const lead = cs.length === 2 && tot[0] !== tot[1] ? (tot[0] > tot[1] ? 0 : 1) : -1;
  const slot = i => {
    const c = cs[i];
    if (!c) return h("div", { class: "pl empty" },
      h("div", { class: "av", text: "❔" }),
      h("div", { class: "nm", text: t("arena.waiting") }),
      isHost() ? h("button", { class: "btn small", style: "margin-top:10px", text: t("invite.share"), onclick: () => { setTab("party"); } }) : null);
    return playerCard(c, st[i], COLORS[i], lead === i);
  };
  box.append(h("div", { class: "vs" }, slot(0), h("div", { class: "vsmid", text: "VS" }), slot(1)));
  if (cs.length === 2) {
    const sum = tot[0] + tot[1];
    const pa = sum ? (tot[0] / sum) * 100 : 50;
    box.append(
      h("div", { class: "tug" }, h("i", { style: `width:${pa}%;background:${COLORS[0]}` }), h("i", { style: `width:${100 - pa}%;background:${COLORS[1]}` })),
      h("div", { class: "tuglabel" },
        h("span", { text: cs[0].nick }),
        h("span", { text: lead < 0 ? t("arena.even") : t("arena.leads", { name: cs[lead].nick, n: Math.abs(tot[0] - tot[1]) }) }),
        h("span", { text: cs[1].nick })),
      hint);
  }
}

/* ---------- result ---------- */
function spin(el, items, final, ms) {
  const t0 = Date.now();
  el.style.transition = "transform .25s";
  const iv = setInterval(() => {
    if (Date.now() - t0 > ms) { clearInterval(iv); el.textContent = final; el.style.transform = "scale(1.08)"; setTimeout(() => { el.style.transform = ""; }, 250); return; }
    el.textContent = pick(items);
  }, 90);
}
function renderResult() {
  const box = $("#resultBox");
  box.replaceChildren();
  if (!S.settings) return;
  const r = currentResult();
  const cs = contestants();
  const host = isHost();
  const hostName = playerName(hostId());

  if (!r) {
    if (!isSolo() && cs.length < 2) return;
    if (isSolo() && cs.length < 1) return;
    const k = "reveal";
    const card = h("div", { class: "card" });
    if (isEnded()) {
      card.append(cardTitle("⏰", t("result.over")));
      if (!host) {
        card.append(h("div", { class: "muted", text: t("result.waiting", { host: hostName }) }));
      } else {
        card.append(h("div", { class: "muted", text: isSolo() ? t("result.solo.q") : t("result.group.q") }));
        if (!isSolo() && groupTie()) {
          card.append(h("div", { class: "muted", style: "margin-top:8px", text: t("result.tie") }),
            h("button", { class: "btn", text: t("result.extend"), onclick: () => saveSettings({ end: addDays(S.settings.end, 1) }) }));
        } else card.append(h("button", { class: "btn", text: t("result.reveal"), onclick: revealResult }));
      }
    } else {
      const sure = S.confirm[k];
      card.append(h("div", { class: "row", style: "align-items:center" },
        h("div", { class: "muted small", style: "font-weight:700", text: t("result.ends", { d: niceDay(S.settings.end) }) }),
        host ? h("button", { class: "btn small ghost", style: "flex:none", text: sure ? t("result.again") : t("result.early"),
          onclick: () => {
            if (!S.confirm[k]) { S.confirm[k] = true; renderResult(); setTimeout(() => { S.confirm[k] = false; renderResult(); }, 4000); }
            else { S.confirm[k] = false; revealResult(); }
          } }) : null));
    }
    box.append(card);
    return;
  }

  const animate = S.animatedTs !== r.ts;
  S.animatedTs = r.ts;
  const nextBtn = host
    ? h("button", { class: "btn ghost", style: "margin-top:14px", text: t("result.newround"), onclick: newRound })
    : h("div", { class: "muted small", style: "margin-top:14px", text: t("result.hostnext", { host: hostName }) });
  let card;

  if (r.solo) {
    const slot = h("div", { class: "slot" });
    card = h("div", { class: "card result" },
      h("div", { class: "av", text: r.hit ? "🎯" : "😬" }),
      h("h2", { text: r.hit ? t("result.hit") : t("result.miss") }),
      h("div", { class: "muted", text: t("result.solo.pts", { s: r.score, t: r.target }) + (r.hit ? "" : t("result.missed", { n: r.target - r.score })) }),
      h("div", { class: "prizes one" },
        h("div", { class: `prize ${r.hit ? "win" : "lose"}` }, h("div", { class: "lab", text: r.hit ? t("result.yourreward") : t("result.yourpunish") }), slot)),
      nextBtn);
    box.append(card);
    const finalTxt = r.hit ? r.reward : r.punishment, items = pool(r.hit ? "rewards" : "punishments");
    if (animate) { spin(slot, items, finalTxt, 2400); setTimeout(() => burst(card, r.hit ? ["🎉", "🏆", "✨", "🎊"] : ["😅", "💪", "📚"]), 2500); }
    else slot.textContent = finalTxt;
    return;
  }

  const rw = h("div", { class: "slot" }), pu = h("div", { class: "slot" });
  const wName = playerName(r.winner);
  const lNames = (r.losers || []).map(playerName);
  const board = (r.board || []).map((b, i) => `${MEDALS[i] || "#" + (i + 1)} ${playerName(b.id)} ${b.total}`).join("  ·  ");
  card = h("div", { class: "card result" },
    h("div", { class: "av", text: "🏆" }),
    h("h2", { text: `${playerAv(r.winner)} ${t("result.wins", { name: wName })}` }),
    h("div", { class: "muted", text: t("result.pts", { n: r.scoreW }) }),
    h("div", { class: "prizes" },
      h("div", { class: "prize win" }, h("div", { class: "lab", text: t("result.reward.of", { name: wName }) }), rw),
      h("div", { class: "prize lose" }, h("div", { class: "lab", text: t("result.punish.of", { names: joinNames(lNames) }) }), pu)),
    board ? h("div", { class: "board", text: board }) : null,
    nextBtn);
  box.append(card);
  if (animate) {
    spin(rw, pool("rewards"), r.reward, 2200);
    spin(pu, pool("punishments"), r.punishment, 3200);
    setTimeout(() => burst(card, ["🎉", "🏆", "✨", "🎊"]), 3300);
  } else { rw.textContent = r.reward; pu.textContent = r.punishment; }
}

/* ---------- today + log form ---------- */
function ringEl(pct, color, big, small) {
  const C = 2 * Math.PI * 38;
  const wrap = h("div", { class: "ring" });
  wrap.innerHTML = `<svg viewBox="0 0 96 96"><circle class="tr" cx="48" cy="48" r="38"/><circle class="pg" cx="48" cy="48" r="38" stroke="${color}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}"/></svg>`;
  const pg = wrap.querySelector(".pg");
  const target = (C * (1 - Math.min(1, pct / 100))).toFixed(1);
  if (document.body.classList.contains("intro")) setTimeout(() => { pg.style.strokeDashoffset = target; }, 80);
  else { pg.style.transition = "none"; pg.style.strokeDashoffset = target; }
  wrap.append(h("div", { class: "lab" }, h("div", {}, big, h("small", { text: small }))));
  return wrap;
}
function renderToday() {
  const box = $("#todayBox");
  box.replaceChildren();
  if (!S.settings) return;
  const tt = today();
  const cs = contestants();
  const goal = S.settings.goal;
  const minsOf = uid => S.logs.filter(l => l.uid === uid && l.day === tt).reduce((a, l) => a + l.minutes, 0);
  const mine = minsOf(S.myId);
  box.append(cardTitle("📅", t("today.title"), t("today.goal", { x: mins(goal) })));
  const list = h("div", { style: "flex:1;min-width:0" });
  const others = cs.filter(c => c.id !== S.myId);
  if (others.length) others.forEach(c => {
    const m = minsOf(c.id);
    list.append(h("div", { class: "sub" },
      h("div", { class: "row", style: "justify-content:space-between;font-weight:700" },
        h("span", { text: `${c.avatar} ${c.nick}` }),
        h("span", { class: "muted", style: "text-align:end", text: `${mins(m)}${m >= goal ? " ✅" : ""}` })),
      h("div", { class: "bar" }, h("i", { style: `width:${Math.min(100, (m / goal) * 100)}%;background:${colorOf(c.id)}` }))));
  });
  else list.append(h("div", { style: "font-weight:800", text: mine >= goal ? t("today.smashed") : mine > 0 ? t("today.keep") : t("today.none") }),
    h("div", { class: "muted", style: "margin-top:2px", text: mine >= goal ? t("today.bonus") : t("today.togo", { x: mins(Math.max(0, goal - mine)) }) }));
  box.append(h("div", { class: "today" },
    ringEl((mine / goal) * 100, colorOf(S.myId), `${Math.min(999, Math.round((mine / goal) * 100))}%`, mins(mine)),
    list));
}
function updatePreview() {
  const m = Math.max(0, +$("#minutes").value || 0);
  const pts = logPoints(m, +$("#diff").value, $("#done").checked);
  const [a, b] = t("log.preview", { n: "\u0001" }).split("\u0001");
  $("#preview").replaceChildren(a, h("span", { class: "tick", text: String(pts) }), b);
}
function refreshSubjects() {
  const seen = [...new Set(S.logs.filter(l => l.uid === S.myId).map(l => l.subject).filter(Boolean))].slice(0, 30);
  $("#subjects").replaceChildren(...seen.map(s => h("option", { value: s })));
}
function refreshForm() {
  if (!S.settings) return;
  const dayEl = $("#day");
  dayEl.min = S.settings.start;
  dayEl.max = today() < S.settings.end ? today() : S.settings.end;
  if (!dayEl.value) dayEl.value = dayEl.max;
}

/* ---------- stats (+ history) ---------- */
const tile = (k, v) => h("div", { class: "tile" }, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }));
function subjectBars(s, color) {
  const entries = Object.entries(s.subjects).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) return h("div", { class: "muted", text: t("stats.nothing") });
  const max = entries[0][1];
  return h("div", {}, entries.map(([k, v]) => h("div", { class: "sub" },
    h("div", { class: "row", style: "justify-content:space-between" }, h("span", { class: "small", style: "font-weight:700", text: k }), h("span", { class: "small muted", style: "text-align:end", text: mins(v) })),
    h("div", { class: "bar" }, h("i", { style: `width:${(v / max) * 100}%;background:${color}` })))));
}
function renderStats() {
  const box = $("#tab-stats");
  box.replaceChildren();
  if (!S.settings) return;
  const cs = contestants();
  if (!cs.length) return;
  const st = cs.map(c => stats(c.id));

  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(today(), -i));
  const maxM = Math.max(S.settings.goal, ...st.map(s => Math.max(0, ...days.map(d => s.byDay[d] || 0))));
  const chart = h("div", { class: "bars" });
  chart.append(h("div", { class: "goalline", style: `bottom:calc(20px + (100% - 20px) * ${S.settings.goal / maxM})` }));
  days.forEach(d => {
    const pair = h("div", { class: "pair" });
    cs.forEach((c, i) => {
      const v = st[i].byDay[d] || 0;
      pair.append(h("i", { style: `height:${(v / maxM) * 100}%;background:${COLORS[i % COLORS.length]}`, title: `${c.nick}: ${v}` }));
    });
    chart.append(h("div", { class: "day" }, pair, h("em", { text: parse(d).toLocaleDateString(LOCALE(), { weekday: "narrow" }) })));
  });
  box.append(h("div", { class: "card" },
    cardTitle("📈", t("stats.last7"), t("stats.minutes")),
    cs.length > 1 ? h("div", { class: "row", style: "gap:12px;flex-wrap:wrap;flex:none;justify-content:flex-start" },
      ...cs.map((c, i) => h("span", { class: "small", style: "flex:none;font-weight:700" }, h("span", { class: "dot", style: `display:inline-block;margin-inline-end:5px;background:${COLORS[i % COLORS.length]}` }), c.nick))) : null,
    chart));

  cs.forEach((c, i) => {
    const s = st[i];
    box.append(h("div", { class: "card" },
      cardTitle(c.avatar, c.nick + (c.id === S.myId ? " " + t("arena.you") : ""), t("stats.level", { n: levelOf(s.total) })),
      h("div", { class: "tiles" },
        tile(t("stats.total"), mins(s.minutes)), tile(t("stats.sessions"), s.ls.length),
        tile(t("stats.beststreak"), daysTxt(s.best)), tile(t("stats.longest"), s.maxSession ? mins(s.maxSession) : "–"),
        tile(t("stats.sesspts"), s.base), tile(t("stats.bonuspts"), s.goalB + s.streakB)),
      h("div", { style: "font-weight:800;margin:16px 0 4px", text: t("stats.bysubject") }),
      subjectBars(s, COLORS[i % COLORS.length])));
  });

  const ids = cs.map(c => c.id);
  const ls = S.logs
    .filter(l => ids.includes(l.uid) && l.day >= S.settings.start && l.day <= S.settings.end)
    .sort((a, b) => (a.day === b.day ? b.ts - a.ts : a.day < b.day ? 1 : -1));
  const hist = h("div", { class: "card" }, cardTitle("📜", t("stats.history"), t("stats.nsessions", { n: ls.length })));
  if (!ls.length) hist.append(h("div", { class: "muted", text: t("stats.nosessions") }));
  ls.slice(0, 200).forEach(l => {
    const idx = ids.indexOf(l.uid);
    hist.append(h("div", { class: "item" },
      h("span", { class: "dot", style: `background:${COLORS[idx % COLORS.length]}` }),
      h("div", { class: "m" },
        h("div", { class: "t", text: `${l.subject || t("log.study")}${l.done ? " ✅" : ""}` }),
        h("div", { class: "s", text: `${playerName(l.uid)} · ${niceDay(l.day)} · ${mins(l.minutes)}${l.note ? " · " + l.note : ""}` })),
      h("div", { class: "p", text: `+${l.points}` }),
      l.uid === S.myId ? h("button", { class: "x", text: "✕", onclick: async () => {
        const k = "del" + l.id;
        if (!S.confirm[k]) { S.confirm[k] = true; toast(t("stats.delconfirm")); setTimeout(() => { S.confirm[k] = false; }, 4000); return; }
        S.confirm[k] = false;
        await safe(() => S.db.doc(P("logs/" + l.id)).delete());
      } }) : null));
  });
  box.append(hist);
}

/* ---------- chat ---------- */
const QUICK_KEYS = ["chat.q1", "chat.q2", "chat.q3", "chat.q4", "chat.q5"];
const EMOJIS = ["😂", "🔥", "💪", "😴", "👏", "😈", "🎉"];
const seenKey = () => "chatseen." + S.party;
const getSeen = () => Math.max(S.seenMem, +LS.get(seenKey()) || 0);
const setSeen = ts => { S.seenMem = Math.max(S.seenMem, ts); LS.set(seenKey(), String(S.seenMem)); };
const visibleChat = () => S.chat.filter(m => !m.to || m.to === S.myId || m.uid === S.myId).sort((a, b) => a.ts - b.ts);
function timeLabel(ts) {
  const d = new Date(ts);
  const tm = d.toLocaleTimeString(LOCALE(), { hour: "2-digit", minute: "2-digit" });
  return dstr(d) === today() ? tm : `${d.toLocaleDateString(LOCALE(), { month: "short", day: "numeric" })} ${tm}`;
}
function renderChat() {
  if (!S.settings) return;
  const vis = visibleChat();
  const latest = vis.length ? vis[vis.length - 1].ts : 0;
  if (S.tab === "chat") setSeen(latest);
  const unread = S.tab === "chat" ? 0 : vis.filter(m => m.uid !== S.myId && m.ts > getSeen()).length;
  const badge = $("#chatBadge");
  const was = badge.textContent;
  badge.hidden = !unread;
  badge.textContent = unread > 9 ? "9+" : String(unread);
  badge.style.animation = badge.textContent === was ? "none" : "";

  const others = contestants().filter(c => c.id !== S.myId);
  if (S.chatTo && !others.some(c => c.id === S.chatTo)) S.chatTo = null;
  $("#chatTo").replaceChildren(
    h("button", { class: S.chatTo ? "" : "on", text: t("chat.everyone"), onclick: () => { S.chatTo = null; renderChat(); } }),
    ...others.map(c => h("button", { class: S.chatTo === c.id ? "on" : "", text: `🔒 ${c.avatar} ${c.nick}`, onclick: () => { S.chatTo = c.id; renderChat(); } })));

  const list = $("#chatList");
  const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  const known = new Set([...list.querySelectorAll("[data-id]")].map(e => e.dataset.id));
  list.replaceChildren();
  if (!vis.length) list.append(h("div", { class: "muted", style: "text-align:center;margin:auto", text: t("chat.empty") }));
  vis.forEach(m => {
    const mine = m.uid === S.myId;
    const noAnim = (known.size && known.has(m.id)) || (known.size === 0 && S.tab !== "chat");
    list.append(h("div", { "data-id": m.id, class: `msg${mine ? " me" : ""}${m.to ? " whisper" : ""}`, style: noAnim ? "animation:none" : "" },
      mine ? null : h("div", { class: "who", style: `color:${colorOf(m.uid)}`, text: `${playerAv(m.uid)} ${playerName(m.uid)}` }),
      h("div", { text: m.text }),
      h("div", { class: "meta" },
        h("span", { text: timeLabel(m.ts) }),
        m.to ? h("span", { text: mine ? t("chat.to", { name: playerName(m.to) }) : t("chat.foryou") }) : null,
        mine ? h("button", { class: "x", style: "font-size:12px;padding:0 4px", text: "✕", onclick: () => safe(() => S.db.doc(P("chat/" + m.id)).delete()) }) : null)));
  });
  if (near) list.scrollTop = list.scrollHeight;
}
async function sendChat(raw) {
  const text = (raw || "").trim().slice(0, 200);
  if (!text || !S.players[S.myId]) return;
  const res = await safe(() => S.db.collection(P("chat")).add({ uid: S.myId, to: S.chatTo || null, text, ts: Date.now() }));
  if (res !== undefined) setTimeout(() => { const l = $("#chatList"); l.scrollTop = l.scrollHeight; }, 60);
}

/* ---------- sharing + QR ---------- */
async function copyText(text, msgKey) {
  try { await navigator.clipboard.writeText(text); toast(t(msgKey)); }
  catch (e) { window.prompt("", text); }
}
async function shareLink(text, url) {
  try { if (navigator.share) { await navigator.share({ text: `${text} ${url}` }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
  copyText(`${text} ${url}`, "invite.copied");
}
function saveQr(link, name) {
  const m = qrMatrix(link, "M"), n = m.length, q = 4, sc = 10;
  const c = document.createElement("canvas");
  c.width = c.height = (n + q * 2) * sc;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  m.forEach((row, y) => row.forEach((v, x) => { if (v) g.fillRect((x + q) * sc, (y + q) * sc, sc, sc); }));
  c.toBlob(b => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}
function qrCard(icon, title, desc, link, shareMsg, fileName, extra, top) {
  const qr = h("div", { class: "qrbox" });
  qr.innerHTML = qrSvg(link, "M", 240); // markup generated locally from numbers only
  return h("div", { class: "card" },
    cardTitle(icon, title, t("hostonly").replace("🔒 ", "👑 ")),
    h("div", { class: "muted small", style: "margin:-6px 0 8px", text: desc }),
    top,
    h("div", { class: "qrwrap" }, qr,
      h("div", { class: "linktxt", text: link }),
      h("div", { class: "btnrow" },
        h("button", { class: "btn", text: t("invite.share"), onclick: () => shareLink(shareMsg, link) }),
        h("button", { class: "btn ghost", text: t("invite.copy"), onclick: () => copyText(link, "invite.copied") }),
        h("button", { class: "btn ghost", text: t("invite.saveqr"), onclick: () => saveQr(link, fileName) })),
      extra));
}

/* ---------- party tab (host controls live here) ---------- */
function renderParty() {
  const box = $("#tab-party");
  const ae = document.activeElement;
  if (box.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
  box.replaceChildren();
  if (!S.settings) return;
  const host = isHost(), solo = isSolo(), st = S.settings;
  const cs = contestants();

  /* invite + app links: host only */
  if (host && !solo && S.info && S.info.key) {
    const k = "newinv";
    const rot = h("button", { class: "btn ghost", style: "margin-top:4px", text: S.confirm[k] ? t("invite.new.sure") : t("invite.new"), onclick: () => {
      if (!S.confirm[k]) { S.confirm[k] = true; renderParty(); setTimeout(() => { S.confirm[k] = false; renderParty(); }, 4000); }
      else { S.confirm[k] = false; rotateInvite(); }
    } });
    rot.style.width = "100%";
    if (!S.info.joinCode && !S.jcTried) { S.jcTried = true; ensureJoinCode(); }
    const jc = S.info.joinCode;
    const codeRow = jc
      ? h("div", { class: "coderow" },
          h("div", {}, h("div", { class: "muted small", style: "font-weight:700", text: t("invite.code") }), h("div", { class: "codebig", text: fmtCode(jc) })),
          h("button", { class: "btn small", text: t("invite.copycode"), onclick: () => copyText(fmtCode(jc), "invite.code.copied") }))
      : h("div", { class: "coderow" },
          h("div", { class: "muted small", style: "flex:1", text: t("code.unavailable") }),
          h("button", { class: "btn small", text: t("code.create"), onclick: async () => { const ok = await ensureJoinCode(); if (!ok) toast(t("code.unavailable")); } }));
    box.append(qrCard("📨", t("invite.title"), t("invite.desc"), inviteLink(), t("invite.msg"), "study-duel-invite.png", rot, codeRow));
  }
  if (host) {
    const hasApk = !!(apkUrl && apkUrl.trim());
    box.append(qrCard("📲", hasApk ? t("app.title.apk") : t("app.title.web"), hasApk ? t("app.desc.apk") : t("app.desc.web"), appLink(), t("app.msg"), "study-duel-app.png"));
  }

  /* members */
  const mem = h("div", { class: "card" }, cardTitle(solo ? "🎯" : "👥", solo ? t("party.yourchallenge") : t("party.members"), solo ? "" : `${cs.length}/${MAX_PLAYERS}`));
  cs.forEach((c, i) => {
    const s = stats(c.id);
    const isH = c.id === hostId();
    const k = "rm" + c.id;
    mem.append(h("div", { class: "item" },
      h("div", { class: "mav", style: `--c:${COLORS[i % COLORS.length]}`, text: c.avatar }),
      h("div", { class: "m" },
        h("div", { class: "t" }, c.nick + (c.id === S.myId ? " " + t("arena.you") : ""), isH ? h("span", { class: "tag", text: t("party.host") }) : null),
        h("div", { class: "s", text: t("party.lvlpts", { n: levelOf(s.total), p: s.total }) })),
      host && !solo && c.id !== S.myId ? h("button", { class: "x", title: t("party.remove"), text: S.confirm[k] ? t("party.sure") : "✕", style: S.confirm[k] ? "font-size:13px;font-weight:800;color:var(--warn)" : "", onclick: () => {
        if (!S.confirm[k]) { S.confirm[k] = true; renderParty(); setTimeout(() => { S.confirm[k] = false; renderParty(); }, 3500); }
        else { S.confirm[k] = false; removeMember(c.id); }
      } }) : null));
  });
  if (host && !solo && cs.length > 1) mem.append(h("div", { class: "muted small", style: "margin-top:8px", text: t("party.removed.note") }));
  box.append(mem);

  /* round settings */
  const round = h("div", { class: "card" }, cardTitle("⚙️", t("round.title"), host ? t("hostctl") : t("hostonly")));
  if (host) {
    const goal = h("input", { type: "number", min: "15", max: "600", step: "15", value: st.goal });
    const end = h("input", { type: "date", value: st.end, min: st.start });
    const target = h("input", { type: "number", min: "10", max: "5000", step: "10", value: st.target || 250 });
    round.append(
      h("div", { class: "row" },
        h("div", {}, h("label", { text: t("round.goal"), style: "margin-top:0" }), goal),
        h("div", {}, h("label", { text: t("round.end"), style: "margin-top:0" }), end)),
      ...(solo ? [h("label", { text: t("round.target") }), target] : []),
      h("button", { class: "btn", text: t("save"), onclick: async () => {
        const patch = { goal: Math.max(15, +goal.value || st.goal), end: end.value && end.value >= st.start ? end.value : st.end };
        if (solo) patch.target = Math.max(10, +target.value || st.target || 250);
        await saveSettings(patch);
        toast(t("saved"));
      } }),
      h("button", { class: "btn ghost", text: t("extend"), onclick: () => saveSettings({ end: addDays(st.end, 1) }) }));
  } else {
    round.append(
      h("div", { class: "kv" }, h("span", { text: t("kv.round") }), h("span", { text: `#${st.round}` })),
      h("div", { class: "kv" }, h("span", { text: t("kv.runs") }), h("span", { text: `${niceDay(st.start)} → ${niceDay(st.end)}` })),
      h("div", { class: "kv" }, h("span", { text: t("kv.goal") }), h("span", { text: mins(st.goal) })),
      h("div", { class: "lock", text: t("locked", { host: playerName(hostId()) }) }));
  }
  box.append(round);

  /* prize pools */
  [["rewards", "🎁", t("rewards"), solo ? t("rewards.sub.solo") : t("rewards.sub.group"), t("add.reward")],
   ["punishments", "😈", t("punish"), solo ? t("punish.sub.solo") : t("punish.sub.group"), t("add.punish")]]
    .forEach(([key, icon, title, sub, ph]) => {
      const card = h("div", { class: "card" }, cardTitle(icon, title, host ? "" : t("hostonly")),
        h("div", { class: "muted small", style: "margin:-6px 0 6px", text: sub }));
      pool(key).forEach((txt, i) => card.append(h("div", { class: "item" },
        h("div", { class: "m" }, h("div", { class: "t", text: txt })),
        host ? h("button", { class: "x", text: "✕", onclick: () => saveSettings({ [key]: pool(key).filter((_, j) => j !== i) }) }) : null)));
      if (host) {
        const inp = h("input", { placeholder: ph, maxlength: "80" });
        const add = () => { const v = inp.value.trim(); if (!v) return; inp.value = ""; saveSettings({ [key]: pool(key).concat(v) }); };
        inp.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
        card.append(h("div", { class: "row", style: "margin-top:12px" }, inp, h("button", { class: "btn small", style: "flex:none", text: t("add"), onclick: add })));
        if (key === "punishments") card.append(h("div", { class: "muted small", style: "margin-top:8px", text: solo ? t("note.solo") : t("note.group") }));
      }
      box.append(card);
    });

  /* how it works */
  box.append(h("div", { class: "card" }, cardTitle("📖", t("how.title")),
    h("div", { class: "muted", style: "line-height:1.8" }, t("how.1"), h("br"), t("how.2"), h("br"), t("how.3"), h("br"), t("how.4"), h("br"), solo ? t("how.solo") : t("how.group"))));

  /* leave */
  box.append(h("div", { class: "card" },
    solo ? h("div", { class: "muted small", style: "margin-bottom:10px", text: t("solo.note") }) : null,
    h("button", { class: "btn ghost", style: "margin-top:0", text: S.confirm.leave ? t("leave.sure") : (solo ? t("startover") : t("leave")), onclick: () => {
      if (!S.confirm.leave) { S.confirm.leave = true; renderParty(); setTimeout(() => { S.confirm.leave = false; if (S.party) renderParty(); }, 4000); }
      else { S.confirm.leave = false; leaveParty(); }
    } })));
}

/* ---------- nav + master render ---------- */
function moveInd() {
  const on = document.querySelector("#navbar button.on:not([hidden])");
  const ind = $("#navind");
  if (!on || !on.offsetWidth) return;
  ind.style.width = on.offsetWidth + "px";
  ind.style.transform = `translateX(${on.offsetLeft}px)`;
}
function updateNav() {
  document.querySelector('#navbar button[data-t="chat"]').hidden = isSolo();
  $("#partyLabel").textContent = isSolo() ? t("nav.challenge") : t("nav.party");
  $("#partyIc").textContent = isSolo() ? "🎯" : "👥";
  if (isSolo() && S.tab === "chat") setTab("home");
  requestAnimationFrame(moveInd);
}
function renderAll() {
  renderGate();
  renderChips();
  renderInstall();
  const showing = !$("#main").hidden;
  if (showing && !S.mainShown) playIntro();
  S.mainShown = showing;
  if (!showing) return;
  renderVS();
  renderResult();
  renderToday();
  refreshForm();
  refreshSubjects();
  renderStats();
  renderChat();
  renderParty();
  updateNav();
}
function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll("#navbar button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  ["home", "stats", "chat", "party"].forEach(n => { $("#tab-" + n).hidden = n !== tab; });
  playIntro();
  moveInd();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (tab === "chat") { renderChat(); const l = $("#chatList"); l.scrollTop = l.scrollHeight; }
  else if (S.settings) renderChat();
}

/* ---------- language ---------- */
function buildStatic() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $("#quick").replaceChildren(...[15, 30, 45, 60, 90].map(m => h("button", { type: "button", text: `${m}${t("u.m")}`, onclick: () => { $("#minutes").value = m; updatePreview(); } })));
  $("#chatQuick").replaceChildren(...QUICK_KEYS.map(k => h("button", { type: "button", text: t(k), onclick: () => sendChat(t(k)) })));
  updatePreview();
  requestAnimationFrame(moveInd);
}
function toggleLang() {
  LANG = LANG === "ar" ? "en" : "ar";
  LS.set("lang", LANG);
  buildStatic();
  S.gateKey = null;
  renderAll();
}

/* ---------- parties: create / join / leave ---------- */
let unsubs = [];
function resetData() {
  S.players = {}; S.logs = []; S.settings = null; S.result = null; S.info = null; S.chat = []; S.chatTo = null;
  S.loaded = { players: false, logs: false, settings: false, result: false, info: false, chat: false };
  S.animatedTs = null; S.lastPts = {}; S.lastLvl = {}; S.mainShown = false; S.kicked = false; S.jcTried = false;
}
function stopListening() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; }
async function tryDo(fn) { try { await fn(); return true; } catch (e) { return false; } }

async function joinWithCode(raw) {
  const c = cleanCode(raw);
  if (c.length !== 8) { toast(t("code.bad")); return; }
  let snap;
  try { snap = await S.db.doc("joinCodes/" + c).get(); } catch (e) { toast(t("err.offline")); return; }
  if (!snap.exists) { toast(t("code.bad")); return; }
  const d = snap.data();
  S.pending = { type: "join", code: d.party, key: d.key };
  renderAll();
}
function startProfile(type) { S.pending = { type }; renderAll(); }
async function submitProfile(nick, avatar) {
  LS.set("nick", nick);
  const pd = S.pending;
  const uid = S.myId;
  if (pd.type === "join") {
    const key = pd.key;
    // already a member of this party on this account? just re-enter
    try { const own = await S.db.doc(`parties/${pd.code}/players/${uid}`).get(); if (own.exists) return enterParty(pd.code); } catch (e) { /* not a member yet */ }
    const ok = await tryDo(() => S.db.doc(`parties/${pd.code}/players/${uid}`).set({ nick, avatar, joinedAt: Date.now(), key }));
    if (!ok) { S.pending = null; toast(t("invite.bad")); renderAll(); return; }
    return enterParty(pd.code);
  }
  const mode = pd.type === "solo" ? "solo" : "group";
  for (let i = 0; i < 5; i++) {
    const code = genCode(), key = genKey();
    const createdTs = Date.now();
    const created = await tryDo(() => S.db.doc("parties/" + code).set({ created: createdTs, owner: uid, mode, key }));
    if (!created) continue;
    const joined = await tryDo(() => S.db.doc(`parties/${code}/players/${uid}`).set({ nick, avatar, joinedAt: Date.now(), key }));
    if (!joined) { toast(t("err.generic")); return; }
    if (mode === "group") {
      // publish the short party code (best effort — the QR/link work even if this fails)
      for (let j = 0; j < 4; j++) {
        const jc = genJoinCode();
        if (await tryDo(() => S.db.doc("joinCodes/" + jc).set({ party: code, key, owner: uid }))) {
          await tryDo(() => S.db.doc("parties/" + code).set({ created: createdTs, owner: uid, mode, key, joinCode: jc }));
          break;
        }
      }
    }
    return enterParty(code);
  }
  toast(t("err.offline"));
}
function enterParty(code) {
  S.pending = null;
  S.party = code;
  LS.set("party", code);
  setTab("home");
  listen();
  renderAll();
}
function leaveLocal() {
  stopListening(); resetData();
  S.party = null; S.pending = null;
  LS.set("party", null);
  renderAll();
}
async function leaveParty() {
  // non-hosts remove themselves from the member list; the host just closes it on this device
  if (S.party && S.players[S.myId] && !isHost()) await tryDo(() => S.db.doc(P("players/" + S.myId)).delete());
  leaveLocal();
}
function listen() {
  stopListening(); resetData();
  const db = S.db;
  const onErr = e => {
    if (e && e.code === "permission-denied") { S.kicked = true; stopListening(); renderAll(); }
    else toast(t("conn"));
  };
  unsubs.push(db.doc("parties/" + S.party).onSnapshot(snap => { S.info = snap.exists ? snap.data() : null; S.loaded.info = true; renderAll(); }, onErr));
  unsubs.push(db.collection(P("players")).onSnapshot(snap => {
    S.players = {};
    snap.docs.forEach(d => { S.players[d.id] = d.data(); });
    S.loaded.players = true; renderAll();
  }, onErr));
  unsubs.push(db.collection(P("logs")).limit(1000).onSnapshot(snap => { S.logs = snap.docs.map(d => ({ id: d.id, ...d.data() })); S.loaded.logs = true; renderAll(); }, onErr));
  unsubs.push(db.doc(P("meta/settings")).onSnapshot(snap => { S.settings = snap.exists ? snap.data() : null; S.loaded.settings = true; renderAll(); }, onErr));
  let firstChat = true;
  unsubs.push(db.collection(P("chat")).orderBy("ts", "desc").limit(100).onSnapshot(snap => {
    S.chat = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!firstChat && S.tab !== "chat") {
      snap.docChanges().filter(c => c.type === "added").forEach(c => {
        const m = c.doc.data();
        if (m && m.uid !== S.myId && (!m.to || m.to === S.myId)) toast(t(m.to ? "chat.notif.priv" : "chat.notif", { name: playerName(m.uid), text: String(m.text).slice(0, 60) }));
      });
    }
    firstChat = false;
    S.loaded.chat = true; renderAll();
  }, onErr));
  let firstResult = true;
  unsubs.push(db.doc(P("meta/result")).onSnapshot(snap => {
    S.result = snap.exists ? snap.data() : null;
    if (firstResult) { firstResult = false; if (S.result) S.animatedTs = S.result.ts; }
    S.loaded.result = true; renderAll();
  }, onErr));
}

/* ---------- static wiring ---------- */
document.querySelectorAll("#navbar button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.t)));
window.addEventListener("resize", moveInd);
["#minutes", "#diff", "#done"].forEach(s => { $(s).addEventListener("input", updatePreview); $(s).addEventListener("change", updatePreview); });
EMOJIS.forEach(e => $("#chatEmo").append(h("button", { type: "button", text: e, onclick: () => { const i = $("#chatIn"); i.value += e; i.focus(); } })));
$("#chatSend").addEventListener("click", async () => { const i = $("#chatIn"); const v = i.value; i.value = ""; await sendChat(v); i.focus(); });
$("#chatIn").addEventListener("keydown", async e => { if (e.key === "Enter") { e.preventDefault(); const i = $("#chatIn"); const v = i.value; i.value = ""; await sendChat(v); } });
$("#logBtn").addEventListener("click", async () => {
  const btn = $("#logBtn");
  const minutes = Math.round(+$("#minutes").value || 0);
  const subject = $("#subject").value.trim();
  if (!subject) { $("#subject").classList.add("shake"); $("#subject").focus(); setTimeout(() => $("#subject").classList.remove("shake"), 400); return toast(t("log.need.subject")); }
  if (minutes < 5) { $("#minutes").classList.add("shake"); setTimeout(() => $("#minutes").classList.remove("shake"), 400); return toast(t("log.need.min")); }
  const day = $("#day").value || today();
  if (day < S.settings.start || day > S.settings.end) return toast(t("log.bad.day"));
  const mult = +$("#diff").value, done = $("#done").checked;
  const points = logPoints(minutes, mult, done);
  btn.disabled = true;
  const res = await addLog({ uid: S.myId, day, subject, minutes, mult, done, points, note: $("#note").value.trim(), ts: Date.now(), round: S.settings.round });
  btn.disabled = false;
  if (res !== undefined) {
    flyPoints(btn, points);
    burst(btn, ["⭐", "✨", "🔥", "📚", "💪"]);
    toast(t("log.earned", { n: points }));
    $("#minutes").value = ""; $("#note").value = ""; $("#done").checked = false;
    updatePreview();
  }
});
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; renderInstall(); });
window.addEventListener("appinstalled", () => { S.installEvt = null; renderInstall(); });

/* ---------- boot ---------- */
function readInvite() {
  const j = new URLSearchParams(location.search).get("join");
  if (!j) return null;
  history.replaceState(null, "", location.pathname);
  const m = /^([A-Za-z0-9]{6})\.([A-Za-z0-9]{12,64})$/.exec(j.trim());
  return m ? { type: "join", code: m[1].toUpperCase(), key: m[2] } : { type: "bad" };
}
async function boot() {
  applyTheme();
  buildStatic();
  const invite = readInvite();
  renderAll();
  if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("./sw.js"); } catch (e) {} }
  if (!configured) return;
  try {
    const app = initializeApp(firebaseConfig);
    const fdb = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    const auth = getAuth(app);
    const existing = await new Promise(res => { const un = onAuthStateChanged(auth, u => { un(); res(u); }); });
    const u = existing || (await signInAnonymously(auth)).user;
    S.myId = u.uid;
    S.db = makeDB(fdb);
  } catch (e) { S.authError = true; renderAll(); return; }

  const saved = LS.get("party");
  if (invite && invite.type === "join" && invite.code !== saved) { S.pending = invite; renderAll(); return; }
  if (invite && invite.type === "bad") toast(t("invite.bad"));
  if (saved) { S.party = saved; listen(); }
  renderAll();
}
boot();
