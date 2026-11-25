// 發票收件匣：本機小伺服器（零相依，需 Node 18+）
// 負責：Gmail OAuth、讀取「發票」標籤的信、解析發票資訊、標記已讀。
// 只綁定 127.0.0.1，token 存在本資料夾的 token.json（不會送到任何第三方）。
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

if (parseInt(process.versions.node, 10) < 18) {
  console.error("需要 Node 18 以上（目前 " + process.version + "）。請用 ./start.sh 啟動。");
  process.exit(1);
}

const DIR = __dirname;
const PORT = Number(process.env.PORT) || 3456;
const LABEL_NAME = process.env.INVOICE_LABEL || "發票";
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const MIN_SYNC_MS = 15000;

const F = n => path.join(DIR, n);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(F(f), "utf8")); } catch { return d; } };
const writeJson = (f, v, mode) => fs.writeFileSync(F(f), JSON.stringify(v, null, 1), mode ? { mode } : undefined);

// ---------- OAuth ----------
function loadCreds() {
  const c = readJson("credentials.json", null);
  const k = c && (c.installed || c.web);
  return k && k.client_id ? k : null;
}
let tokens = readJson("token.json", null);
let oauthState = null;

async function tokenRequest(params) {
  const k = loadCreds();
  const body = new URLSearchParams({ client_id: k.client_id, client_secret: k.client_secret, ...params });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error("OAuth：" + (j.error_description || j.error));
  return j;
}
async function accessToken() {
  if (!tokens) throw Object.assign(new Error("尚未授權"), { code: "NO_AUTH" });
  if (!tokens.expires_at || Date.now() > tokens.expires_at - 60000) {
    try {
      const j = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
      tokens = { ...tokens, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
      writeJson("token.json", tokens, 0o600);
    } catch (e) {
      tokens = null;
      throw Object.assign(new Error("授權已失效，請重新授權"), { code: "NO_AUTH" });
    }
  }
  return tokens.access_token;
}
async function gmail(p, opt = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me" + p, {
      method: opt.method || "GET",
      headers: { Authorization: "Bearer " + (await accessToken()), "Content-Type": "application/json" },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const msg = (j.error && j.error.message) || "";
    const quota = r.status === 429 || (r.status === 403 && /quota|rate limit/i.test(msg));
    if (quota && attempt < 4) { await new Promise(res => setTimeout(res, 8000 * (attempt + 1))); continue; } // 配額：等一下重試
    throw Object.assign(new Error("Gmail API " + r.status + "：" + msg), { quota });
  }
}

// ---------- 解析 ----------
const b64 = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function collect(part, out) {
  if (part.body && part.body.data && /^text\/(plain|html)/.test(part.mimeType || "")) out.push([part.mimeType, b64(part.body.data)]);
  (part.parts || []).forEach(p => collect(p, out));
}
const stripHtml = h => h
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x3D;/g, "=").replace(/&quot;/g, '"')
  .replace(/[ \t　]+/g, " ").replace(/\s*\n\s*/g, "\n");

const STORE_BY_ADDR = {
  "support@ecloudlife.com": "CHARGESPOT（共享數位服務股份有限公司）",
  "no_reply@email.apple.com": "Apple Distribution International Ltd.",
  "service@mycard520.com.tw": "MyCard",
  "invoice@mail2.ei.com.tw": "香港商旺拓有限公司台灣分公司",
  "noreply@uberegui.com": "優食台灣股份有限公司（Uber Eats）",
  "noreply@steampowered.com": "Steam（Valve）",
  "system@eslite.com": "誠品線上",
  "b2ceci@ecimail3.tradevan.com.tw": "新加坡商蝦皮娛樂電商有限公司台灣分公司",
};
const ITEM_BY_ADDR = { // [item, itemSrc]
  "support@ecloudlife.com": ["行動電源租借", "rule"],
  "invoice@mail2.ei.com.tw": ["訂閱服務", "user"],
  "service@mycard520.com.tw": ["遊戲點數", "user"],
};

function parseMessage(m, overrides) {
  const h = {};
  (m.payload.headers || []).forEach(x => (h[x.name.toLowerCase()] = x.value));
  const from = h.from || "";
  const addr = ((from.match(/<([^>]+)>/) || [])[1] || from).toLowerCase().trim();
  const display = from.replace(/<.*$/, "").replace(/"/g, "").trim();
  const subject = h.subject || "";
  const parts = []; collect(m.payload, parts);
  const plain = parts.filter(p => /plain/.test(p[0])).map(p => p[1]).join("\n");
  const html = parts.filter(p => /html/.test(p[0])).map(p => p[1]).join("\n");
  const text = (plain || stripHtml(html) || m.snippet || "").replace(/[ \t　]+/g, " ");
  const flat = (subject + "\n" + text).replace(/\s+/g, " ");

  let no = (flat.match(/(?:發票號碼|發 票 號 碼|Invoice Number)[^A-Z0-9]{0,15}([A-Z]{2}-?\d{8})/) || [])[1]
    || (flat.match(/統一編號\s*[:：]?\s*([A-Z]{2}\d{8})/) || [])[1]
    || (subject.match(/\b([A-Z]{2}-?\d{8})\b/) || [])[1]
    || (flat.match(/\b([A-Z]{2}-\d{8})\b/) || [])[1];
  no = no ? no.replace("-", "") : null;

  const dm = flat.match(/(?:開立日期|發票日期|統一發票日期|Issuance Date)[^\d]{0,20}(\d{4})[\/\-年]?(\d{2})[\/\-月]?(\d{2})/)
    || flat.match(/(?:^|\s)日期\s*(\d{4})[\/\-年](\d{2})[\/\-月](\d{2})/)
    || flat.match(/\b(\d{4})-(\d{2})-(\d{2}) \d{2}:\d{2}/);
  const idate = new Date(Number(m.internalDate));
  const pad = n => String(n).padStart(2, "0");
  const d = dm ? `${dm[1]}/${dm[2]}/${dm[3]}` : `${idate.getFullYear()}/${pad(idate.getMonth() + 1)}/${pad(idate.getDate())}`;

  let amt = null;
  for (const re of [/消費金額[^\d$]{0,30}\$?\s*([\d,]+)/, /發票金額[^\d$]{0,10}\$?\s*([\d,]+)/, /總計[^\d$]{0,10}(?:NT)?\$?\s*([\d,]+)(?!\s*項)/, /(?:^|\s)金額[：: ]+([\d,]+)/]) {
    const x = flat.match(re); if (x) { amt = Number(x[1].replace(/,/g, "")); break; }
  }

  let store = STORE_BY_ADDR[addr];
  if (!store && /ezpay/.test(addr) && /^(.+?)電子發票/.test(subject)) store = subject.match(/^(.+?)電子發票/)[1] + "（ezPay）";
  if (!store) {
    const e = flat.match(/感謝您自\s*(.+?)\s*購買商品/);
    store = e ? e[1] : /uxb2b/.test(addr) ? (text.trim().split("\n")[0] || "").trim() : display.replace(/電子發票.*$/, "") || addr;
  }

  let item = null, itemSrc = null;
  const ap = html.match(/class="title"[^>]*>\s*([^<]+?)\s*</);
  const xs = flat.match(/品名 數量 單價 金額 (.+?) \d+ [\d,]+ [\d,]+/);
  if (/apple\.com$/.test(addr) && ap) { item = ap[1].replace(/\s+/g, " "); itemSrc = "inv"; }
  else if (xs) { item = xs[1] + " ×1"; itemSrc = "inv"; }
  else if (ITEM_BY_ADDR[addr]) { [item, itemSrc] = ITEM_BY_ADDR[addr]; }

  const rec = { id: m.id, threadId: m.threadId, addr, no, d, amt, item, itemSrc, store, subject,
    note: (flat.match(/訂單編號\s*(\d{8,})/) || [])[1] ? "訂單編號 " + flat.match(/訂單編號\s*(\d{8,})/)[1] : "" };
  const ov = no && overrides[no];
  if (ov) { for (const k of Object.keys(ov)) rec[k] = ov[k]; rec.curated = true; }
  return rec;
}

// ---------- 同步 ----------
let cache = readJson("cache.json", {}); // id -> parsed record
let labelId = null, lastSync = 0, last = { rows: [], error: null, at: 0 }, syncing = null;

async function listIds(labelIds) {
  const ids = []; let pageToken = "";
  do {
    const q = new URLSearchParams({ maxResults: "500" });
    labelIds.forEach(l => q.append("labelIds", l));
    if (pageToken) q.set("pageToken", pageToken);
    const j = await gmail("/messages?" + q);
    (j.messages || []).forEach(x => ids.push(x.id));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return ids;
}
async function pool(items, n, fn) {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: n }, async () => { for (const x of it) await fn(x); }));
}
// ---------- 自動歸類：把還沒貼「發票」標籤的新發票信找出來並貼上 ----------
const AUTO_LABEL = process.env.AUTO_LABEL !== "0";
const DISCOVER_DAYS = +process.env.DISCOVER_DAYS || 30, DISCOVER_EVERY_MS = 60000;
const SENDER_OK = /(ecloudlife\.com|email\.apple\.com|mycard520\.com\.tw|ei\.com\.tw|uberegui\.com|steampowered\.com|eslite\.com|tradevan\.com\.tw|ecpay\.com\.tw|ezpay\.com\.tw|uxb2b\.com|foodpanda\.tweinv\.com|gateweb\.com\.tw|cyberbiz\.co)$/i;
const SUBJ_OK = /電子發票|發票開立|開立發票|發票通知|e-?invoice/i;
const SUBJ_NO = /中獎|歸戶|領獎|載具|密碼|條碼|Carrier|Award|one-time/i;
let checked = readJson("checked.json", {}), lastDiscover = 0, autoLog = readJson("autolabel.json", []);
let discoverState = readJson("discover-state.json", {}); // { full: true } 代表第一次全信箱掃描已完成
async function discover(overrides) {
  if (!AUTO_LABEL || Date.now() - lastDiscover < DISCOVER_EVERY_MS) return;
  lastDiscover = Date.now();
  // 第一次執行：掃整個信箱（不限天數、跑完所有分頁）；完成後改為只掃最近 DISCOVER_DAYS 天
  const full = !discoverState.full;
  const q = `-label:"${LABEL_NAME}" ${full ? "" : "newer_than:" + DISCOVER_DAYS + "d "}-in:sent -in:trash -in:spam (subject:發票 OR "發票號碼" OR "電子發票")`;
  const found = []; let pageToken = "";
  do {
    const j = await gmail("/messages?maxResults=100&q=" + encodeURIComponent(q) + (pageToken ? "&pageToken=" + pageToken : ""));
    (j.messages || []).forEach(x => found.push(x.id));
    pageToken = full ? j.nextPageToken : "";
  } while (pageToken);
  const todo = found.filter(id => !checked[id] && !cache[id]);
  if (full && !todo.length) { discoverState.full = true; writeJson("discover-state.json", discoverState); console.log("[自動歸類] 第一次全信箱掃描完成，之後只掃最近 " + DISCOVER_DAYS + " 天"); return; }
  for (const id of todo.slice(0, 20)) {
    const m = await gmail("/messages/" + id + "?format=full");
    const rec = parseMessage(m, overrides);
    const ok = rec.no && !SUBJ_NO.test(rec.subject) && (SENDER_OK.test(rec.addr) || SUBJ_OK.test(rec.subject));
    if (ok) {
      await gmail("/messages/" + id + "/modify", { method: "POST", body: { addLabelIds: [labelId] } });
      rec.auto = true; cache[id] = rec;
      autoLog.push({ id, no: rec.no, store: rec.store, subject: rec.subject, at: new Date().toISOString() });
      console.log(`[自動歸類] ${rec.no} ${rec.store}｜${rec.subject}`);
      writeJson("cache.json", cache); writeJson("autolabel.json", autoLog);
    }
    checked[id] = 1; writeJson("checked.json", checked);
  }
}

async function doSync() {
  if (!labelId) {
    const j = await gmail("/labels");
    const l = (j.labels || []).find(x => x.name === LABEL_NAME);
    if (l) labelId = l.id;
    else {
      // 找不到標籤就自動建立（新使用者第一次使用）
      const c = await gmail("/labels", { method: "POST", body: { name: LABEL_NAME, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      labelId = c.id;
      console.log(`[建立標籤] ${LABEL_NAME}`);
    }
  }
  try { await discover(readJson("overrides.json", {})); } catch (e) { console.log("[自動歸類失敗] " + e.message); }
  const [all, unread] = await Promise.all([listIds([labelId]), listIds([labelId, "UNREAD"])]);
  const overrides = readJson("overrides.json", {});
  const fresh = all.filter(id => !cache[id]);
  const batch = fresh.slice(0, 30); // 每輪最多抓 30 封，避免瞬間超過 Gmail 配額
  let err = null;
  try {
    await pool(batch, 2, async id => {
      const m = await gmail("/messages/" + id + "?format=full");
      cache[id] = parseMessage(m, overrides);
    });
  } catch (e) { err = e; }
  if (batch.length) writeJson("cache.json", cache); // 失敗也保留已抓到的
  const un = new Set(unread);
  last = {
    rows: all.filter(id => cache[id]).map(id => ({ ...cache[id], unread: un.has(id) })),
    pending: all.filter(id => !cache[id]).length,
    error: err ? err.message : null, at: Date.now(),
  };
  if (err) throw err;
  if (last.pending) setTimeout(() => sync(true), 3000); // 還有沒抓完的，接著抓
}
function sync(force) {
  if (syncing) return syncing;
  if (!force && Date.now() - lastSync < MIN_SYNC_MS) return Promise.resolve();
  lastSync = Date.now();
  syncing = doSync().catch(e => { last = { ...last, error: e.message, code: e.code }; if (e.quota) lastSync = Date.now() + 45000; }).finally(() => { syncing = null; });
  return syncing;
}

// ---------- 中獎號碼（財政部公開 RSS）----------
let prizes = readJson("prizes.json", { at: 0, items: [] });
async function getPrizes() {
  if (Date.now() - prizes.at < 6 * 3600 * 1000) return prizes;
  try {
    const r = await fetch("https://invoice.etax.nat.gov.tw/invoice.xml", { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const xml = await r.text();
    const items = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const t = m[1].match(/<title><!\[CDATA\[(\d+)年\s*(\d+)~(\d+)月\]\]>/);
      if (!t) continue;
      const nums = lbl => ((m[1].match(new RegExp(lbl + "：([\\d、]+)")) || [])[1] || "").split("、").filter(x => /^\d{8}$/.test(x));
      const year = Number(t[1]) + 1911;
      items.push({ key: year + "-" + Math.ceil(Number(t[2]) / 2), title: `${t[1]}年 ${t[2]}~${t[3]}月`,
        special: nums("特別獎"), grand: nums("特獎"), firsts: nums("頭獎") });
    }
    if (!items.length) throw new Error("解析不到中獎號碼");
    prizes = { at: Date.now(), items };
    writeJson("prizes.json", prizes);
    return prizes;
  } catch (e) {
    return { ...prizes, error: e.message }; // 失敗就用上次的
  }
}

// ---------- HTTP ----------
const send = (res, code, body, type) => {
  res.writeHead(code, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const readBody = req => new Promise(r => { let s = ""; req.on("data", c => (s += c)); req.on("end", () => r(s)); });

module.exports = { parseMessage };
if (require.main === module) http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/index.html"))
      return send(res, 200, fs.readFileSync(F("index.html"), "utf8"), "text/html; charset=utf-8");

    if (u.pathname === "/auth") {
      if (!loadCreds()) return send(res, 400, "找不到 credentials.json", "text/plain; charset=utf-8");
      oauthState = crypto.randomBytes(16).toString("hex");
      const q = new URLSearchParams({ client_id: loadCreds().client_id, redirect_uri: REDIRECT, response_type: "code",
        scope: SCOPE, access_type: "offline", prompt: "consent", state: oauthState });
      res.writeHead(302, { Location: "https://accounts.google.com/o/oauth2/v2/auth?" + q }); return res.end();
    }
    if (u.pathname === "/oauth2callback") {
      if (!oauthState || u.searchParams.get("state") !== oauthState) return send(res, 400, "state 不符", "text/plain; charset=utf-8");
      oauthState = null;
      const code = u.searchParams.get("code");
      if (!code) return send(res, 400, "授權被取消：" + (u.searchParams.get("error") || ""), "text/plain; charset=utf-8");
      const j = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: REDIRECT });
      tokens = { refresh_token: j.refresh_token, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
      writeJson("token.json", tokens, 0o600);
      res.writeHead(302, { Location: "/" }); return res.end();
    }

    if (u.pathname === "/api/prizes") return send(res, 200, await getPrizes());

    if (u.pathname === "/api/state") {
      if (!loadCreds()) return send(res, 200, { setup: "credentials", rows: [] });
      if (!tokens) return send(res, 200, { setup: "auth", rows: [] });
      await sync(u.searchParams.get("force") === "1");
      return send(res, 200, { rows: last.rows, pending: last.pending || 0, error: last.error, code: last.code, at: last.at, label: LABEL_NAME });
    }

    if (req.method === "POST" && u.pathname === "/api/read") {
      // 擋掉跨站請求：必須自訂 header 且 Origin 為本機
      const origin = req.headers.origin || "";
      if (req.headers["x-invoice-app"] !== "1" || (origin && origin !== `http://localhost:${PORT}`))
        return send(res, 403, { error: "forbidden" });
      const { ids } = JSON.parse((await readBody(req)) || "{}");
      const valid = (ids || []).filter(id => cache[id]); // 只允許動「發票」標籤內、已知的信
      if (valid.length) {
        await gmail("/messages/batchModify", { method: "POST", body: { ids: valid, removeLabelIds: ["UNREAD"] } });
        const s = new Set(valid);
        last.rows = last.rows.map(r => (s.has(r.id) ? { ...r, unread: false } : r));
      }
      return send(res, 200, { ok: true, count: valid.length });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`發票收件匣：http://localhost:${PORT}`);
  if (!loadCreds()) console.log("尚未設定 credentials.json（請看網頁上的步驟）");
});
