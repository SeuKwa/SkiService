#!/usr/bin/env node
/* Ski Service Chartreuse — serveur minimal (Node natif, zéro dépendance)
   - Rend le site depuis data/content.json + views/index.html
   - Back-office : /admin (page protégée par mot de passe) + API JSON
   Démarrage : node server.js   (PORT=3000 par défaut, ADMIN_PASSWORD requis en prod) */

"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const DATA_FILE = path.join(__dirname, "data", "content.json");
const DATA_BACKUP = path.join(__dirname, "data", "content.backup.json");
const VIEWS = path.join(__dirname, "views");
const PUBLIC_DIR = __dirname;

/* ───────────────────────── Sessions & sécurité ───────────────────────── */

const SESSIONS = new Map(); // token -> expiry
const SESSION_TTL = 12 * 3600 * 1000;
const LOGIN_ATTEMPTS = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 10 * 60 * 1000;

function newSession() {
  const token = crypto.randomBytes(32).toString("hex");
  SESSIONS.set(token, Date.now() + SESSION_TTL);
  return token;
}

function cleanSessions() {
  const now = Date.now();
  for (const [t, exp] of SESSIONS) if (exp < now) SESSIONS.delete(t);
}

function tokenFromRequest(req) {
  const m = /(?:^|;\s*)ssc_token=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  return m ? m[1] : null;
}

function isAuthorized(req) {
  const token = tokenFromRequest(req);
  if (!token) return false;
  const exp = SESSIONS.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    SESSIONS.delete(token);
    return false;
  }
  return true;
}

function loginAllowed(ip) {
  const now = Date.now();
  const rec = LOGIN_ATTEMPTS.get(ip);
  if (!rec || now > rec.resetAt) return true;
  return rec.count < MAX_ATTEMPTS;
}

function registerFailedLogin(ip) {
  const now = Date.now();
  const rec = LOGIN_ATTEMPTS.get(ip);
  if (!rec || now > rec.resetAt) LOGIN_ATTEMPTS.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW });
  else rec.count++;
}

/* ───────────────────────── Mini moteur de template ───────────────────────── */

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function lookup(stack, name) {
  if (name === ".") {
    const top = stack[stack.length - 1];
    return top && typeof top === "object" && "." in top ? top["."] : top;
  }
  const parts = name.split(".");
  for (let i = stack.length - 1; i >= 0; i--) {
    let v = stack[i];
    for (const p of parts) {
      if (v == null) { v = undefined; break; }
      v = v[p];
    }
    if (v !== undefined) return v;
  }
  return undefined;
}

function findClose(tpl, name, from) {
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\{\\{\\s*([#^/])\\s*${escName}\\s*\\}\\}`, "g");
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(tpl))) {
    if (m[1] === "/") {
      if (--depth === 0) return { start: m.index, end: re.lastIndex };
    } else depth++;
  }
  return { start: tpl.length, end: tpl.length };
}

function render(tpl, data) {
  function walk(tpl, stack) {
    let out = "", i = 0;
    while (i < tpl.length) {
      const o = tpl.indexOf("{{", i);
      if (o < 0) return out + tpl.slice(i);
      out += tpl.slice(i, o);
      const isRaw = tpl[o + 2] === "{" && tpl[o + 1] === "{";
      const closeSeq = isRaw ? "}}}" : "}}";
      const c = tpl.indexOf(closeSeq, o + (isRaw ? 3 : 2));
      if (c < 0) return out + tpl.slice(o);
      const tag = tpl.slice(o + (isRaw ? 3 : 2), c).trim();

      if (tag.startsWith("#") || tag.startsWith("^")) {
        const name = tag.slice(1).trim();
        const close = findClose(tpl, name, c + 2);
        const body = tpl.slice(c + 2, close.start);
        const val = lookup(stack, name);
        const truthy = Array.isArray(val) ? val.length > 0 : !!val;
        if (tag[0] === "#" ? truthy : !truthy) {
          if (Array.isArray(val)) {
            for (const item of val) {
              walk.stack = null;
              out += walk(body, [...stack, item !== null && typeof item === "object" ? item : { ".": item }]);
            }
          } else {
            out += walk(body, [...stack, val && typeof val === "object" ? val : {}]);
          }
        }
        i = close.end;
      } else if (tag.startsWith("/")) {
        i = c + 2;
      } else {
        const val = lookup(stack, tag);
        out += val === undefined || val === null ? "" : isRaw ? String(val) : esc(val);
        i = c + closeSeq.length;
      }
    }
    return out;
  }
  return walk(tpl, [data]);
}

/* ───────────────────────── Utilitaires HTTP ───────────────────────── */

function send(res, status, body, headers = {}) {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  res.writeHead(status, { "Content-Length": buf.length, ...headers });
  res.end(buf);
}

function sendJSON(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", ...headers });
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body trop volumineux")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function serveFile(res, root, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(root, safe);
  if (!file.startsWith(root)) return false;
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    return false;
  }
  send(res, 200, data, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
  return true;
}

/* ───────────────────────── Contenu ───────────────────────── */

async function readContent() {
  return JSON.parse(await fsp.readFile(DATA_FILE, "utf8"));
}

async function saveContent(content) {
  const json = JSON.stringify(content, null, 2) + "\n";
  try { await fsp.copyFile(DATA_FILE, DATA_BACKUP); } catch {}
  const tmp = DATA_FILE + ".tmp";
  await fsp.writeFile(tmp, json, "utf8");
  await fsp.rename(tmp, DATA_FILE);
}

function validateContent(c) {
  if (!c || typeof c !== "object") return "objet attendu";
  const need = ["hero", "stats", "sections", "services", "shops", "quote", "contact", "footer"];
  for (const k of need) if (!c[k] || typeof c[k] !== "object") return `propriété « ${k} » manquante ou invalide`;
  if (!Array.isArray(c.stats)) return "« stats » doit être une liste";
  if (!Array.isArray(c.services)) return "« services » doit être une liste";
  if (!Array.isArray(c.shops)) return "« shops » doit être une liste";
  return null;
}

/* ───────────────────────── Routes ───────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const ip = req.socket.remoteAddress || "?";

  try {
    /* — API admin — */
    if (pathname === "/admin/login" && req.method === "POST") {
      if (!loginAllowed(ip)) return sendJSON(res, 429, { error: "Trop de tentatives. Réessayez dans quelques minutes." });
      const body = JSON.parse(await readBody(req) || "{}");
      const password = typeof body.password === "string" ? body.password : "";
      if (ADMIN_PASSWORD && password.length === ADMIN_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD))) {
        cleanSessions();
        const token = newSession();
        LOGIN_ATTEMPTS.delete(ip);
        return sendJSON(res, 200, { ok: true }, {
          "Set-Cookie": `ssc_token=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`,
        });
      }
      registerFailedLogin(ip);
      return sendJSON(res, 401, { error: "Mot de passe incorrect." });
    }

    if (pathname === "/admin/logout" && req.method === "POST") {
      const token = tokenFromRequest(req);
      if (token) SESSIONS.delete(token);
      return sendJSON(res, 200, { ok: true }, { "Set-Cookie": "ssc_token=; HttpOnly; Path=/; Max-Age=0" });
    }

    if (pathname.startsWith("/admin/api/")) {
      if (!isAuthorized(req)) return sendJSON(res, 401, { error: "Non autorisé" }, { "Cache-Control": "no-store" });

      if (pathname === "/admin/api/content" && req.method === "GET") {
        const content = await readContent();
        return sendJSON(res, 200, content, { "Cache-Control": "no-store" });
      }
      if (pathname === "/admin/api/content" && req.method === "PUT") {
        const content = JSON.parse(await readBody(req));
        const err = validateContent(content);
        if (err) return sendJSON(res, 400, { error: err });
        await saveContent(content);
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 404, { error: "Introuvable" });
    }

    /* — Pages admin — */
    if (pathname === "/admin" || pathname === "/admin/") {
      return serveFile(res, VIEWS, "admin.html")
        ? undefined
        : send(res, 404, "Introuvable");
    }

    /* — Site public — */
    if (pathname === "/" || pathname === "/index.html") {
      const [tpl, content] = await Promise.all([
        fsp.readFile(path.join(VIEWS, "index.html"), "utf8"),
        readContent(),
      ]);
      return send(res, 200, render(tpl, content), { "Content-Type": "text/html; charset=utf-8" });
    }

    if (pathname === "/favicon.ico") return send(res, 204, "", { "Content-Length": 0 });

    if (serveFile(res, PUBLIC_DIR, pathname)) return undefined;
    return send(res, 404, "Page introuvable", { "Content-Type": "text/plain; charset=utf-8" });
  } catch (err) {
    console.error("Erreur:", err.message);
    return sendJSON(res, 500, { error: "Erreur interne du serveur" });
  }
});

server.listen(PORT, () => {
  console.log(`Ski Service Chartreuse → http://localhost:${PORT}`);
  console.log(`Admin → http://localhost:${PORT}/admin`);
  if (!ADMIN_PASSWORD) console.warn("⚠ ADMIN_PASSWORD non défini — connexion admin impossible. Définissez-la : ADMIN_PASSWORD=... node server.js");
});
