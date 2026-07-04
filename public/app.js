/* Bottle Publisher - interfaccia (vanilla JS, nessuna dipendenza) */

const $ = (id) => document.getElementById(id);

const state = {
  pendingPhotos: [], // dataURL delle foto scelte, in attesa di analisi
  draft: null,       // bozza aperta nell'editor
  config: { gemini: false, ebay: false, ebayEnv: 'production' },
};

const PORTALI = [
  { nome: 'Subito.it', url: 'https://www.subito.it/ai/form/0' },
  { nome: 'Vinted', url: 'https://www.vinted.it/items/new' },
  { nome: 'Facebook Marketplace', url: 'https://www.facebook.com/marketplace/create/item' },
  { nome: 'Wallapop', url: 'https://it.wallapop.com/app/catalog/upload' },
];

/* ---------- utilità ---------- */

function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function overlay(show, text) {
  $('overlay').classList.toggle('hidden', !show);
  if (text) $('overlayText').textContent = text;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// Ridimensiona una foto lato telefono prima dell'invio (max 1600px, JPEG).
function compressImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossibile leggere la foto.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato foto non supportato.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Copia testo negli appunti; il fallback serve perché su HTTP di rete locale
// l'API clipboard moderna è bloccata dal browser.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('📋 Copiato!');
}

function euro(n) {
  return Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

/* ---------- navigazione ---------- */

function showHome() {
  state.draft = null;
  $('viewEditor').classList.add('hidden');
  $('viewHome').classList.remove('hidden');
  loadDrafts();
  window.scrollTo(0, 0);
}

function showEditor(draft) {
  state.draft = draft;
  $('viewHome').classList.add('hidden');
  $('viewEditor').classList.remove('hidden');
  renderEditor();
  window.scrollTo(0, 0);
}

/* ---------- config e avvisi ---------- */

async function loadConfig() {
  try {
    state.config = await api('GET', '/api/config');
  } catch {
    return;
  }
  const missing = [];
  if (!state.config.gemini) missing.push('<b>GEMINI_API_KEY</b> (per generare gli annunci)');
  if (!state.config.ebay) missing.push('<b>EBAY_USER_TOKEN</b> (per pubblicare su eBay)');
  const banner = $('setupBanner');
  if (missing.length) {
    banner.innerHTML = `⚙️ Configurazione incompleta: manca ${missing.join(' e ')}.<br>
      Apri il file <b>.env</b> nella cartella dell'app sul PC e inserisci le chiavi (istruzioni nel README).`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

/* ---------- lista bozze ---------- */

async function loadDrafts() {
  const listEl = $('draftList');
  let drafts;
  try {
    drafts = await api('GET', '/api/drafts');
  } catch (e) {
    listEl.innerHTML = `<p class="muted">Errore: ${e.message}</p>`;
    return;
  }
  if (!drafts.length) {
    listEl.innerHTML = '<p class="muted">Nessun annuncio ancora.</p>';
    return;
  }
  listEl.innerHTML = '';
  for (const d of drafts) {
    const item = document.createElement('div');
    item.className = 'draft-item';
    const badge = d.status === 'pubblicato'
      ? '<span class="badge pubblicato">su eBay</span>'
      : d.valutazione && !d.valutazione.pubblicare
        ? '<span class="badge sconsigliata">sconsigliata</span>'
        : '<span class="badge">bozza</span>';
    item.innerHTML = `
      <img src="/photos/${d.id}/${d.photos[0]}" alt="">
      <div class="info">
        <div class="title"></div>
        <div class="meta">${euro(d.prezzo || 0)} · ${new Date(d.createdAt).toLocaleDateString('it-IT')} ${badge}</div>
      </div>`;
    item.querySelector('.title').textContent = d.titolo || '(senza titolo)';
    item.addEventListener('click', () => showEditor(d));
    listEl.appendChild(item);
  }
}

/* ---------- scelta foto e analisi ---------- */

async function onPhotosPicked(files, inputEl) {
  if (!files.length) return;
  const room = 12 - state.pendingPhotos.length;
  const all = [...files].slice(0, room);
  if (files.length > room) toast('Massimo 12 foto per annuncio.');
  overlay(true, 'Preparo le foto...');
  try {
    for (const f of all) {
      state.pendingPhotos.push(await compressImage(f));
    }
  } catch (e) {
    toast('Errore foto: ' + e.message);
  } finally {
    overlay(false);
    inputEl.value = ''; // permette di riselezionare le stesse foto
  }
  renderPendingThumbs();
}

function renderPendingThumbs() {
  const thumbs = $('thumbs');
  thumbs.innerHTML = '';
  state.pendingPhotos.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    const img = document.createElement('img');
    img.src = src;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '✕';
    wrap.append(img, x);
    wrap.addEventListener('click', () => {
      state.pendingPhotos.splice(i, 1);
      renderPendingThumbs();
    });
    thumbs.appendChild(wrap);
  });
  const btn = $('analyzeBtn');
  btn.classList.toggle('hidden', !state.pendingPhotos.length);
  btn.textContent = `✨ Genera annuncio (${state.pendingPhotos.length} foto)`;
}

async function analyze() {
  if (!state.pendingPhotos.length) return;
  overlay(true, "🔍 Analizzo le foto, scrivo l'annuncio e, se vale la pena,\nlo pubblico su eBay... (fino a un minuto)");
  try {
    const { draft, autoPublish } = await api('POST', '/api/analyze', { photos: state.pendingPhotos });
    state.pendingPhotos = [];
    renderPendingThumbs();
    showEditor(draft);
    if (autoPublish.published) {
      toast('✅ Vendibile: pubblicato automaticamente su eBay!', 5000);
    } else {
      toast('📝 Annuncio generato ma NON pubblicato (vedi motivo).', 5000);
    }
  } catch (e) {
    toast('Errore: ' + e.message, 5000);
  } finally {
    overlay(false);
  }
}

/* ---------- editor ---------- */

const FIELD_IDS = {
  titolo: 'fTitolo',
  prezzo: 'fPrezzo',
  descrizione: 'fDescrizione',
  epoca: 'fEpoca',
  materiale: 'fMateriale',
  colore: 'fColore',
  altezzaCm: 'fAltezzaCm',
  condizione: 'fCondizione',
};

function renderEditor() {
  const d = state.draft;

  const photosEl = $('editorPhotos');
  photosEl.innerHTML = '';
  for (const name of d.photos) {
    const img = document.createElement('img');
    img.src = `/photos/${d.id}/${name}`;
    photosEl.appendChild(img);
  }

  for (const [field, id] of Object.entries(FIELD_IDS)) {
    $(id).value = d[field] ?? '';
  }
  updateTitleCount();
  $('priceRange').textContent =
    d.prezzoMin && d.prezzoMax ? `(stima AI: ${euro(d.prezzoMin)} - ${euro(d.prezzoMax)})` : '';

  renderEbayStatus();
  renderPortals();
}

function updateTitleCount() {
  $('titleCount').textContent = `(${$('fTitolo').value.length}/80)`;
}

function collectFields() {
  const out = {};
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    const v = $(id).value;
    out[field] = field === 'prezzo' || field === 'altezzaCm' ? (v === '' ? null : Number(v)) : v;
  }
  return out;
}

async function saveDraft(silent = false) {
  if (!state.draft) return;
  try {
    state.draft = await api('PUT', `/api/drafts/${state.draft.id}`, collectFields());
    if (!silent) toast('💾 Salvato');
    renderPortals();
  } catch (e) {
    toast('Errore salvataggio: ' + e.message, 4000);
    throw e;
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function renderEbayStatus() {
  const d = state.draft;
  const el = $('ebayStatus');
  const btn = $('publishEbayBtn');

  let html = '';
  if (d.modelloAI) {
    html += `<p class="muted small">🤖 Annuncio generato da <b>${escapeHtml(d.modelloAI)}</b></p>`;
  }
  const verdict = d.valutazione;
  if (verdict && verdict.motivo) {
    html += verdict.pubblicare
      ? `<div class="verdict ok">🤖 <b>Vendibile secondo l'AI:</b> ${escapeHtml(verdict.motivo)}</div>`
      : `<div class="verdict bad">🤖 <b>L'AI sconsiglia la vendita:</b> ${escapeHtml(verdict.motivo)}</div>`;
  }
  const photoCheck = d.valutazioneFoto;
  if (photoCheck) {
    if (!photoCheck.sufficienti) {
      const missing = (photoCheck.mancanti || []).join(', ');
      html += `<div class="verdict bad">📷 <b>Foto insufficienti:</b> ${escapeHtml(missing || photoCheck.note || 'servono più inquadrature')}</div>`;
    } else if (photoCheck.note) {
      html += `<div class="verdict ok">📷 <b>Foto:</b> ${escapeHtml(photoCheck.note)}</div>`;
    }
  }

  if (d.ebay && d.ebay.itemId) {
    html += `<div class="ebay-ok">✅ Pubblicato su eBay (n. ${escapeHtml(d.ebay.itemId)})<br>
      <a href="${escapeHtml(d.ebay.url)}" target="_blank" rel="noopener">Apri l'inserzione →</a></div>`;
    el.innerHTML = html;
    btn.classList.add('hidden');
    return;
  }

  if (d.autoNote) {
    html += `<div class="verdict bad">⏸ <b>Non pubblicato in automatico:</b> ${escapeHtml(d.autoNote)}</div>`;
  }
  if (state.config.ebayEnv === 'sandbox') {
    html += '<p class="muted small">Modalità SANDBOX attiva: la pubblicazione è solo di prova.</p>';
  }
  el.innerHTML = html;
  btn.classList.remove('hidden');
  btn.disabled = !state.config.ebay;
  const override = verdict && !verdict.pubblicare;
  btn.textContent = !state.config.ebay
    ? '🚀 Pubblica su eBay (configura .env)'
    : override ? '🚀 Pubblica comunque su eBay' : '🚀 Pubblica su eBay';
}

async function publishEbay() {
  if (!state.draft) return;
  try {
    await saveDraft(true);
  } catch {
    return;
  }
  overlay(true, '🚀 Carico le foto su eBay e pubblico...\n(può volerci un minuto)');
  try {
    state.draft = await api('POST', `/api/drafts/${state.draft.id}/publish/ebay`);
    renderEbayStatus();
    toast('✅ Pubblicato su eBay!', 4000);
    window.scrollTo(0, 0);
  } catch (e) {
    toast('Errore eBay: ' + e.message, 8000);
  } finally {
    overlay(false);
  }
}

/* ---------- export altri portali ---------- */

function portalText() {
  const d = collectFields();
  const extra = [
    d.epoca && `Epoca: ${d.epoca}`,
    d.materiale && `Materiale: ${d.materiale}`,
    d.colore && `Colore: ${d.colore}`,
    d.altezzaCm && `Altezza indicativa: ${d.altezzaCm} cm`,
    d.condizione && `Condizione: ${d.condizione}`,
  ].filter(Boolean).join('\n');
  return `${d.titolo}\n\nPrezzo: ${euro(d.prezzo || 0)}\n\n${d.descrizione}${extra ? '\n\n' + extra : ''}`;
}

function renderPortals() {
  const wrap = $('portalCards');
  wrap.innerHTML = '';
  const full = portalText();
  const d = collectFields();
  for (const p of PORTALI) {
    const card = document.createElement('div');
    card.className = 'portal-card';
    card.innerHTML = `
      <div class="portal-head">
        <span>${p.nome}</span>
        <a href="${p.url}" target="_blank" rel="noopener">Apri portale →</a>
      </div>
      <textarea rows="4" readonly></textarea>
      <button class="btn small secondary" data-copy="titolo">Copia titolo</button>
      <button class="btn small secondary" data-copy="descrizione">Copia descrizione</button>
      <button class="btn small secondary" data-copy="tutto">Copia tutto</button>`;
    card.querySelector('textarea').value = full;
    card.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const what = btn.dataset.copy;
        copyText(what === 'titolo' ? d.titolo : what === 'descrizione' ? d.descrizione : full);
      });
    });
    wrap.appendChild(card);
  }
}

/* ---------- fotocamera integrata (scatti multipli) ---------- */

let camStream = null;

async function openCamera() {
  // getUserMedia richiede HTTPS (o localhost): altrove si torna alla
  // fotocamera nativa del telefono (uno scatto alla volta).
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('cameraInput').click();
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false,
    });
  } catch {
    // permesso negato o fotocamera occupata: fallback nativo
    $('cameraInput').click();
    return;
  }
  $('cameraVideo').srcObject = camStream;
  updateCamCount();
  $('cameraView').classList.remove('hidden');
}

function closeCamera() {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
  $('cameraVideo').srcObject = null;
  $('cameraView').classList.add('hidden');
  renderPendingThumbs();
}

function updateCamCount() {
  $('camCount').textContent = `${state.pendingPhotos.length} foto`;
}

function shoot() {
  if (state.pendingPhotos.length >= 12) {
    toast('Massimo 12 foto per annuncio.');
    return;
  }
  const video = $('cameraVideo');
  if (!video.videoWidth) return;
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  state.pendingPhotos.push(canvas.toDataURL('image/jpeg', 0.85));
  updateCamCount();
  video.classList.remove('cam-flash');
  void video.offsetWidth; // riavvia l'animazione
  video.classList.add('cam-flash');
}

/* ---------- eliminazione ---------- */

async function deleteDraft() {
  if (!state.draft) return;
  if (!confirm('Eliminare questo annuncio e le sue foto dal PC?\n(Se già pubblicato, l\'inserzione su eBay NON viene rimossa.)')) return;
  try {
    await api('DELETE', `/api/drafts/${state.draft.id}`);
    toast('🗑 Eliminato');
    showHome();
  } catch (e) {
    toast('Errore: ' + e.message, 4000);
  }
}

/* ---------- avvio ---------- */

$('cameraBtn').addEventListener('click', openCamera);
$('camShutter').addEventListener('click', shoot);
$('camClose').addEventListener('click', closeCamera);
$('cameraInput').addEventListener('change', (e) => onPhotosPicked(e.target.files, e.target));
$('galleryInput').addEventListener('change', (e) => onPhotosPicked(e.target.files, e.target));
$('analyzeBtn').addEventListener('click', analyze);
$('backBtn').addEventListener('click', showHome);
$('saveBtn').addEventListener('click', () => saveDraft());
$('publishEbayBtn').addEventListener('click', publishEbay);
$('deleteBtn').addEventListener('click', deleteDraft);
$('fTitolo').addEventListener('input', updateTitleCount);

loadConfig();
loadDrafts();
