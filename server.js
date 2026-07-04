import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { Store } from './lib/store.js';
import { analyzeBottle } from './lib/gemini.js';
import { uploadPicture, publishListing, getShippingServices } from './lib/ebay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envLoaded = loadEnv(__dirname);
const store = new Store(path.join(__dirname, 'data'));
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 80 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Campi della bozza modificabili dall'interfaccia.
const EDITABLE = ['titolo', 'descrizione', 'prezzo', 'condizione', 'epoca', 'materiale', 'colore', 'altezzaCm'];

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (ch) => {
      size += ch.length;
      if (size > MAX_BODY) {
        reject(new Error('Foto troppo pesanti: riprova con meno foto.'));
        req.destroy();
        return;
      }
      chunks.push(ch);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('Richiesta non valida (JSON malformato).');
  }
}

function parseDataUrl(s) {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(s || '');
  if (!m) throw new Error('Formato foto non valido.');
  return { mimeType: m[1], base64: m[2], buffer: Buffer.from(m[2], 'base64') };
}

// Carica le foto della bozza su eBay e pubblica l'inserzione.
async function publishDraftToEbay(draft) {
  const urls = [];
  for (let i = 0; i < draft.photos.length; i++) {
    const buf = fs.readFileSync(store.photoPath(draft.id, draft.photos[i]));
    urls.push(await uploadPicture(process.env, buf, `${draft.titolo || 'bottiglia'} ${i + 1}`));
  }
  const result = await publishListing(process.env, draft, urls);
  return store.update(draft.id, {
    status: 'pubblicato',
    autoNote: null,
    ebay: { ...result, publishedAt: new Date().toISOString() },
  });
}

// Decide se pubblicare subito la bozza appena analizzata.
// Restituisce { published, reason } e aggiorna la bozza di conseguenza.
async function maybeAutoPublish(draft) {
  const enabled = (process.env.AUTO_PUBLISH || 'true').toLowerCase() !== 'false';
  const minPrice = Number(process.env.AUTO_PUBLISH_MIN_PRICE || '0');
  const verdict = draft.valutazione || { pubblicare: true, motivo: '' };

  let reason = null;
  if (!enabled) {
    reason = 'Pubblicazione automatica disattivata (AUTO_PUBLISH=false nel .env).';
  } else if (!verdict.pubblicare) {
    reason = verdict.motivo || "L'AI ritiene che non valga la pena venderla.";
  } else if (minPrice > 0 && Number(draft.prezzo) < minPrice) {
    reason = `Prezzo stimato (${draft.prezzo} €) sotto la soglia AUTO_PUBLISH_MIN_PRICE (${minPrice} €).`;
  } else if (!process.env.EBAY_USER_TOKEN) {
    reason = 'eBay non configurato: inserisci le chiavi nel file .env.';
  }

  if (!reason) {
    try {
      await publishDraftToEbay(draft);
      return { published: true, reason: null };
    } catch (err) {
      reason = `Errore eBay durante la pubblicazione automatica: ${err.message}`;
    }
  }
  store.update(draft.id, { autoNote: reason });
  return { published: false, reason };
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendError(res, 404, 'Non trovato');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // es. ['api','drafts','abc123','publish','ebay']

  // GET /api/config — quali chiavi sono configurate (per gli avvisi in UI)
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, {
      envFile: envLoaded,
      gemini: Boolean(process.env.GEMINI_API_KEY),
      ebay: Boolean(process.env.EBAY_USER_TOKEN),
      ebayEnv: (process.env.EBAY_ENV || 'production').toLowerCase(),
    });
  }

  // POST /api/analyze — { photos: [dataURL, ...] } → crea bozza con testo
  // generato e, se l'AI la ritiene vendibile, pubblica subito su eBay.
  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    const body = await readJson(req);
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (photos.length < 1) return sendError(res, 400, 'Nessuna foto ricevuta.');
    if (photos.length > 12) return sendError(res, 400, 'Massimo 12 foto per annuncio.');
    const parsed = photos.map(parseDataUrl);
    const fields = await analyzeBottle(
      parsed.map((p) => ({ mimeType: p.mimeType, base64: p.base64 })),
      process.env
    );
    const draft = store.create(fields, parsed.map((p) => p.buffer));
    const autoPublish = await maybeAutoPublish(draft);
    return sendJson(res, 200, { draft: store.get(draft.id), autoPublish });
  }

  // GET /api/drafts — elenco bozze
  if (req.method === 'GET' && url.pathname === '/api/drafts') {
    return sendJson(res, 200, store.list());
  }

  // /api/drafts/:id ...
  if (parts[0] === 'api' && parts[1] === 'drafts' && parts[2]) {
    const id = parts[2];
    const draft = store.get(id);
    if (!draft) return sendError(res, 404, 'Bozza non trovata.');

    if (req.method === 'GET' && parts.length === 3) {
      return sendJson(res, 200, draft);
    }

    if (req.method === 'PUT' && parts.length === 3) {
      const body = await readJson(req);
      const fields = {};
      for (const key of EDITABLE) {
        if (key in body) fields[key] = body[key];
      }
      return sendJson(res, 200, store.update(id, fields));
    }

    if (req.method === 'DELETE' && parts.length === 3) {
      store.remove(id);
      return sendJson(res, 200, { ok: true });
    }

    // POST /api/drafts/:id/publish/ebay — pubblicazione manuale (override)
    if (req.method === 'POST' && parts[3] === 'publish' && parts[4] === 'ebay') {
      return sendJson(res, 200, await publishDraftToEbay(draft));
    }
  }

  // GET /api/ebay/shipping-services — codici di spedizione validi (diagnostica)
  if (req.method === 'GET' && url.pathname === '/api/ebay/shipping-services') {
    return sendJson(res, 200, await getShippingServices(process.env));
  }

  return sendError(res, 404, 'Endpoint non trovato.');
}

// Protezione con password (indispensabile se l'app è esposta su internet):
// imposta APP_PASSWORD nel .env. Il nome utente è indifferente.
function isAuthorized(req) {
  const password = process.env.APP_PASSWORD || '';
  if (!password) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const given = Buffer.from(decoded.split(':').slice(1).join(':'));
  const expected = Buffer.from(password);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (!isAuthorized(req)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="Bottle Publisher", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Accesso protetto: inserisci la password (nome utente qualsiasi).');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    // Foto salvate: /photos/<idBozza>/<file>
    if (url.pathname.startsWith('/photos/')) {
      const [, , id, name] = url.pathname.split('/');
      if (!id || !name) return sendError(res, 404, 'Non trovato');
      serveFile(res, store.photoPath(decodeURIComponent(id), decodeURIComponent(name)));
      return;
    }

    // File statici dell'interfaccia
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Accesso negato');
    serveFile(res, filePath);
  } catch (err) {
    console.error(`[errore] ${req.method} ${url.pathname}:`, err.message);
    sendError(res, 500, err.message || 'Errore interno');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🍾 Bottle Publisher avviato!\n');
  console.log(`     Sul PC:        http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`     Dal telefono:  http://${a.address}:${PORT}   (rete "${name}")`);
      }
    }
  }
  console.log('\n     Telefono e PC devono essere sulla stessa rete Wi-Fi.');
  if (!envLoaded) {
    console.log('\n  ⚠️  File .env non trovato: copia .env.example in .env e inserisci le chiavi API.');
  } else {
    if (!process.env.GEMINI_API_KEY) console.log('\n  ⚠️  GEMINI_API_KEY non impostata nel .env: la generazione annunci non funzionerà.');
    if (!process.env.EBAY_USER_TOKEN) console.log('  ⚠️  EBAY_USER_TOKEN non impostato nel .env: la pubblicazione su eBay non funzionerà.');
  }
  console.log('');
});
