// Analisi foto con i modelli Gemini (piano gratuito).
// I modelli si provano in ordine di priorità (GEMINI_MODELS nel .env): se uno
// esaurisce le richieste gratuite (429) o non è disponibile, si passa
// automaticamente al successivo. I modelli esauriti restano "in pausa" per il
// tempo indicato da Google, così le richieste successive non li ritentano.

const DEFAULT_MODELS = [
  'gemini-3.5-flash',      // qualità migliore (20 richieste/giorno gratis)
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite', // riserva grande: 500 richieste/giorno
  'gemma-4-31b-it',        // ultima spiaggia: 1500 richieste/giorno
];

const PROMPT = `Sei un esperto di vini e distillati d'epoca, di bottiglie da collezione e di vendita su marketplace online italiani (eBay, Subito.it).
Analizza le foto di questa bottiglia e prepara un annuncio di vendita in ITALIANO.

CONTESTO DI CONSERVAZIONE (vale per tutte le bottiglie di questo venditore):
le bottiglie sono state conservate per anni in una tavernetta domestica a
temperatura NON controllata (sbalzi tra estate e inverno), NON in una cantina
professionale. Di conseguenza:
- se la bottiglia è PIENA (vino, spumante, liquore, distillato), la corretta
  conservazione non è garantita: osserva dalle foto il livello di riempimento
  (ullage), eventuali colature, lo stato di tappo/capsula e il colore del
  liquido, e considera la bevibilità INCERTA (per i vini spesso compromessa;
  i distillati ad alta gradazione reggono meglio);
- il valore va stimato soprattutto come pezzo da COLLEZIONE/ESPOSIZIONE
  (marchio, annata, etichetta, rarità della bottiglia), applicando uno sconto
  realistico e consistente (indicativamente 30-60%) rispetto alle quotazioni di
  un esemplare ben conservato; i distillati mal conservati si svalutano meno
  dei vini;
- se la bottiglia è VUOTA, valutala come oggetto da collezione (vetro, epoca,
  marchio, serigrafie).

Nella "descrizione" DEVI sempre includere, con totale onestà:
- un paragrafo sulla conservazione: conservata per anni in tavernetta a
  temperatura non controllata, non in cantina professionale;
- per le bottiglie piene: che la bevibilità NON è garantita e che la bottiglia
  è venduta come PEZZO DA COLLEZIONE - il valore è nel contenitore e
  nell'etichetta, il contenuto non è destinato al consumo; vendita riservata
  ai maggiorenni;
- ciò che osservi davvero dalle foto: livello di riempimento, stato di
  capsula/tappo, condizioni dell'etichetta, colore del liquido, difetti.

Rispondi SOLO con un oggetto JSON valido, senza alcun testo aggiuntivo, con questa struttura esatta:
{
  "titolo": "titolo dell'annuncio, MASSIMO 80 caratteri, ricco di parole chiave utili alla ricerca (tipo di bottiglia, epoca, materiale, colore, eventuale marchio)",
  "descrizione": "descrizione dettagliata e onesta in italiano: che tipo di bottiglia è, epoca stimata, materiale, colore, tecnica di lavorazione se riconoscibile, eventuali scritte o marchi in rilievo, stato di conservazione ed eventuali difetti visibili (sbeccature, graffi, opacità, residui). Struttura il testo in paragrafi separati da righe vuote. Chiudi invitando a guardare bene le foto, che fanno parte integrante della descrizione.",
  "prezzo_consigliato": 0,
  "prezzo_min": 0,
  "prezzo_max": 0,
  "epoca": "es. 'Primo Novecento', 'Anni '50'",
  "materiale": "es. 'Vetro soffiato a bocca'",
  "colore": "colore prevalente",
  "altezza_stimata_cm": null,
  "condizione": "breve frase sullo stato di conservazione",
  "parole_chiave": ["parola1", "parola2"],
  "vendibilita": {
    "pubblicare": true,
    "motivo": "una o due frasi: perché vale (o non vale) la pena metterla in vendita"
  },
  "foto": {
    "sufficienti": true,
    "mancanti": ["inquadrature da aggiungere, es. 'etichetta posteriore', 'collo con capsula e livello'"],
    "note": "giudizio sintetico su quantità e qualità delle foto"
  }
}

Regole per "foto" (valuta le immagini che ti sono state fornite):
- per un buon annuncio servono almeno 3-4 inquadrature: fronte con etichetta ben leggibile, retro/controetichetta, collo con capsula e livello di riempimento, dettaglio di eventuali difetti;
- "sufficienti": false se c'è una sola foto generica, se l'etichetta non si legge, o se le foto sono sfocate o troppo buie;
- in "mancanti" elenca le inquadrature da aggiungere (lista vuota se non manca nulla);
- in "note" un giudizio breve e concreto (es. "foto nitide ma manca il retro").

Regole per "vendibilita" (decidi tu, con onestà, tenendo conto della conservazione in tavernetta):
- "pubblicare": false se la bottiglia è comune e recente senza alcun valore collezionistico (es. vino da tavola industriale, bottiglia moderna qualsiasi), se dalle foto non si capisce cosa sia, o se il prezzo realistico è talmente basso (sotto i 5-8 euro) da non ripagare tempo e spedizione. Un vino comune per di più conservato male non vale la pena;
- "pubblicare": true quando l'oggetto ha un mercato plausibile tra collezionisti o appassionati: un marchio o un'annata prestigiosi possono valere come pezzo da collezione ANCHE se la bevibilità è compromessa;
- in "motivo" spiega la decisione in modo concreto, citando anche l'effetto della conservazione (es. "annata pregiata, valore da collezione nonostante bevibilità incerta" oppure "vino comune con conservazione non ottimale: non conviene").

Regole per il prezzo (numeri in euro, senza simboli):
- sii realistico per il mercato italiano dell'usato e del piccolo collezionismo (prezzi tipo eBay Italia e Subito.it, NON prezzi da casa d'aste);
- APPLICA SEMPRE lo sconto per la conservazione in tavernetta descritto sopra: mai quotare una bottiglia piena come se fosse stata in cantina professionale;
- una bottiglia comune vale poco (5-20 euro), una rara/prestigiosa di più anche se mal conservata;
- prezzo_consigliato deve stare tra prezzo_min e prezzo_max.

Non inventare marchi, date o epoche che non puoi dedurre dalle foto: se non sei sicuro, usa formule prudenti ("probabilmente", "da collocare indicativamente").`;

// Modelli momentaneamente non usabili: nome -> timestamp (ms) di fine pausa.
const cooldowns = new Map();

// Errore che significa "prova il modello successivo" (gli altri sono fatali).
class SkipModel extends Error {}

function modelChain(env) {
  const raw = env.GEMINI_MODELS || env.GEMINI_MODEL || '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// Durata della pausa dopo un 429: usa il retryDelay suggerito da Google se
// presente; se la quota esaurita è quella GIORNALIERA, pausa lunga.
function cooldownAfter429(bodyText) {
  let seconds = 120;
  try {
    const err = JSON.parse(bodyText).error || {};
    const retry = (err.details || []).find((d) => String(d['@type'] || '').includes('RetryInfo'));
    const m = /^(\d+)/.exec(String(retry?.retryDelay || ''));
    if (m) seconds = Math.max(30, Number(m[1]));
    if (/per\s?day/i.test(JSON.stringify(err))) seconds = Math.max(seconds, 3600);
  } catch {
    // corpo non leggibile: si usa il default
  }
  return seconds * 1000;
}

async function generateWithModel(model, photos, key) {
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          ...photos.map((p) => ({
            inline_data: { mime_type: p.mimeType, data: p.base64 },
          })),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      response_mime_type: 'application/json',
    },
  };

  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
  } catch {
    throw new Error('Impossibile contattare Google Gemini: controlla la connessione a internet del PC.');
  }

  if (!res.ok) {
    const bodyText = await res.text();
    if (res.status === 429) {
      const until = Date.now() + cooldownAfter429(bodyText);
      cooldowns.set(model, until);
      throw new SkipModel(`richieste gratuite esaurite, in pausa fino alle ${fmtTime(until)}`);
    }
    if (res.status === 404) {
      cooldowns.set(model, Date.now() + 24 * 3600 * 1000);
      throw new SkipModel('modello inesistente o ritirato da Google');
    }
    if (res.status >= 500) {
      cooldowns.set(model, Date.now() + 60 * 1000);
      throw new SkipModel(`errore temporaneo di Google (HTTP ${res.status})`);
    }
    // Chiave non valida: inutile provare altri modelli
    if (/api[ _]?key/i.test(bodyText)) {
      throw new Error(`Chiave Gemini non valida (HTTP ${res.status}): controlla GEMINI_API_KEY nel file .env.`);
    }
    // Altri 4xx: richiesta non supportata da QUESTO modello -> prova il prossimo
    throw new SkipModel(`richiesta rifiutata (HTTP ${res.status}): ${bodyText.slice(0, 150)}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('');
  if (!text) throw new SkipModel('risposta vuota (foto forse rifiutate dai filtri)');

  const parsed = extractJson(text);
  if (!parsed) throw new SkipModel('risposta non in formato JSON');
  return parsed;
}

// Estrae l'oggetto JSON dalla risposta, tollerando recinti ``` e testo di
// "ragionamento" prima del JSON (tipico dei modelli Gemma).
function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // si prova dal primo '{' in poi, spostandosi avanti a ogni fallimento
  }
  const end = cleaned.lastIndexOf('}');
  let start = cleaned.indexOf('{');
  while (start !== -1 && start < end) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      start = cleaned.indexOf('{', start + 1);
    }
  }
  return null;
}

function normalize(parsed, model) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  return {
    titolo: String(parsed.titolo || 'Bottiglia antica da collezione').slice(0, 80),
    descrizione: String(parsed.descrizione || ''),
    prezzo: num(parsed.prezzo_consigliato) || 10,
    prezzoMin: num(parsed.prezzo_min),
    prezzoMax: num(parsed.prezzo_max),
    epoca: String(parsed.epoca || ''),
    materiale: String(parsed.materiale || ''),
    colore: String(parsed.colore || ''),
    altezzaCm: num(parsed.altezza_stimata_cm),
    condizione: String(parsed.condizione || ''),
    paroleChiave: Array.isArray(parsed.parole_chiave) ? parsed.parole_chiave.map(String) : [],
    valutazione: {
      pubblicare: parsed.vendibilita ? Boolean(parsed.vendibilita.pubblicare) : true,
      motivo: String(parsed.vendibilita?.motivo || ''),
    },
    valutazioneFoto: {
      sufficienti: parsed.foto ? Boolean(parsed.foto.sufficienti) : true,
      mancanti: Array.isArray(parsed.foto?.mancanti) ? parsed.foto.mancanti.map(String) : [],
      note: String(parsed.foto?.note || ''),
    },
    modelloAI: model,
  };
}

// photos: array di { mimeType, base64 }
export async function analyzeBottle(photos, env) {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY mancante: apri il file .env e inserisci la chiave (gratis su https://aistudio.google.com/apikey).');
  }

  const chain = modelChain(env);
  const skipped = [];

  for (const model of chain) {
    const until = cooldowns.get(model);
    if (until && until > Date.now()) {
      skipped.push(`${model}: in pausa fino alle ${fmtTime(until)}`);
      continue;
    }
    try {
      const parsed = await generateWithModel(model, photos, key);
      if (model !== chain[0]) {
        console.log(`[gemini] modello principale non disponibile, usato: ${model}`);
      }
      return normalize(parsed, model);
    } catch (err) {
      if (!(err instanceof SkipModel)) throw err;
      console.warn(`[gemini] ${model} saltato: ${err.message}`);
      skipped.push(`${model}: ${err.message}`);
    }
  }

  throw new Error(
    `Nessun modello Gemini disponibile in questo momento — ${skipped.join(' | ')}. Riprova più tardi.`
  );
}
