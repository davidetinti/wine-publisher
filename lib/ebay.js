// Client per le eBay Trading API (gratuite): upload foto su eBay Picture
// Services + pubblicazione inserzione a prezzo fisso. Nessuna dipendenza:
// XML costruito e letto direttamente.

const ENDPOINTS = {
  production: 'https://api.ebay.com/ws/api.dll',
  sandbox: 'https://api.sandbox.ebay.com/ws/api.dll',
};
const COMPATIBILITY_LEVEL = '1193';

function cfg(env) {
  const environment = (env.EBAY_ENV || 'production').toLowerCase();
  const token = (env.EBAY_USER_TOKEN || '').trim();
  if (!token) {
    throw new Error('EBAY_USER_TOKEN mancante: apri il file .env e inserisci il token utente eBay (vedi README).');
  }
  return {
    environment,
    endpoint: ENDPOINTS[environment] || ENDPOINTS.production,
    token,
    // I token OAuth iniziano con "v^1.1": vanno nell'header IAF.
    // I token Auth'n'Auth vanno nel corpo XML.
    isOAuth: token.startsWith('v^'),
    siteId: env.EBAY_SITE_ID || '101',
    appId: (env.EBAY_APP_ID || '').trim(),
    devId: (env.EBAY_DEV_ID || '').trim(),
    certId: (env.EBAY_CERT_ID || '').trim(),
  };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decodeXml(m[1].trim()) : null;
}

function xmlBlocks(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function buildHeaders(c, callName, contentType) {
  const h = {
    'X-EBAY-API-COMPATIBILITY-LEVEL': COMPATIBILITY_LEVEL,
    'X-EBAY-API-CALL-NAME': callName,
    'X-EBAY-API-SITEID': c.siteId,
    'Content-Type': contentType,
  };
  if (c.isOAuth) h['X-EBAY-API-IAF-TOKEN'] = c.token;
  if (c.appId) h['X-EBAY-API-APP-NAME'] = c.appId;
  if (c.devId) h['X-EBAY-API-DEV-NAME'] = c.devId;
  if (c.certId) h['X-EBAY-API-CERT-NAME'] = c.certId;
  return h;
}

function credentialsXml(c) {
  return c.isOAuth
    ? ''
    : `<RequesterCredentials><eBayAuthToken>${esc(c.token)}</eBayAuthToken></RequesterCredentials>`;
}

function checkAck(xml, callName, httpStatus) {
  const ack = xmlText(xml, 'Ack');
  if (ack === 'Success' || ack === 'Warning') return;
  const errors = xmlBlocks(xml, 'Errors')
    .filter((b) => (xmlText(b, 'SeverityCode') || '') !== 'Warning')
    .map((b) => xmlText(b, 'LongMessage') || xmlText(b, 'ShortMessage'))
    .filter(Boolean);
  const detail = errors.length
    ? errors.join(' | ')
    : `HTTP ${httpStatus}, risposta: ${xml.slice(0, 400)}`;
  throw new Error(`eBay - ${callName} fallita: ${detail}`);
}

async function tradingCall(env, callName, innerXml) {
  const c = cfg(env);
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">` +
    credentialsXml(c) +
    innerXml +
    `</${callName}Request>`;
  const res = await fetch(c.endpoint, {
    method: 'POST',
    headers: buildHeaders(c, callName, 'text/xml; charset=utf-8'),
    body: xml,
  });
  const text = await res.text();
  checkAck(text, callName, res.status);
  return text;
}

// Carica una foto su eBay Picture Services e restituisce l'URL ospitato.
export async function uploadPicture(env, buffer, name) {
  const c = cfg(env);
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">` +
    credentialsXml(c) +
    `<PictureName>${esc(name)}</PictureName>` +
    `<PictureSet>Standard</PictureSet>` +
    `</UploadSiteHostedPicturesRequest>`;

  const boundary = 'EBAY-BOUNDARY-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="XML Payload"\r\n` +
        `Content-Type: text/xml; charset=utf-8\r\n\r\n` +
        xml +
        `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="image.jpg"\r\n` +
        `Content-Type: application/octet-stream\r\n` +
        `Content-Transfer-Encoding: binary\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch(c.endpoint, {
    method: 'POST',
    headers: buildHeaders(c, 'UploadSiteHostedPictures', `multipart/form-data; boundary=${boundary}`),
    body,
  });
  const text = await res.text();
  checkAck(text, 'UploadSiteHostedPictures', res.status);
  const url = xmlText(text, 'FullURL');
  if (!url) throw new Error("eBay non ha restituito l'URL della foto caricata.");
  return url;
}

// Token applicazione (client credentials) per le API REST, con cache.
let appTokenCache = { token: null, expiresAt: 0 };

async function getAppToken(env) {
  if (appTokenCache.token && Date.now() < appTokenCache.expiresAt) {
    return appTokenCache.token;
  }
  const c = cfg(env);
  if (!c.appId || !c.certId) {
    throw new Error('EBAY_APP_ID / EBAY_CERT_ID mancanti nel file .env.');
  }
  const base = c.environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
  const basic = Buffer.from(`${c.appId}:${c.certId}`).toString('base64');
  const res = await fetch(`${base}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Token applicazione eBay rifiutato: ${JSON.stringify(data).slice(0, 200)}`);
  }
  appTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in || 7200) - 60) * 1000,
  };
  return appTokenCache.token;
}

// Chiede a eBay una categoria adatta a partire dal titolo (null se non trovata).
// Usa la Taxonomy API: la vecchia GetSuggestedCategories è stata dismessa.
// L'ID dell'albero categorie coincide con il site ID (101 = eBay Italia).
export async function suggestCategory(env, title) {
  try {
    const c = cfg(env);
    const base = c.environment === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
    const token = await getAppToken(env);
    const res = await fetch(
      `${base}/commerce/taxonomy/v1/category_tree/${encodeURIComponent(c.siteId)}/get_category_suggestions?q=${encodeURIComponent(title)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.categorySuggestions?.[0]?.category?.categoryId || null;
  } catch {
    return null;
  }
}

// Lista dei servizi di spedizione validi per il sito configurato.
export async function getShippingServices(env) {
  const xml = await tradingCall(env, 'GeteBayDetails', '<DetailName>ShippingServiceDetails</DetailName>');
  return xmlBlocks(xml, 'ShippingServiceDetails')
    .filter((b) => (xmlText(b, 'ValidForSellingFlow') || '').toLowerCase() === 'true')
    .map((b) => ({
      codice: xmlText(b, 'ShippingService'),
      descrizione: xmlText(b, 'Description'),
    }))
    .filter((s) => s.codice);
}

function descriptionHtml(draft) {
  const paragraphs = String(draft.descrizione || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const rows = [
    ['Epoca', draft.epoca],
    ['Materiale', draft.materiale],
    ['Colore', draft.colore],
    ['Altezza indicativa', draft.altezzaCm ? `${draft.altezzaCm} cm` : ''],
    ['Condizione', draft.condizione],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`)
    .join('\n');
  return (
    `${paragraphs}\n${rows ? `<ul>${rows}</ul>` : ''}\n` +
    `<p><b>Bottiglia venduta come pezzo da collezione:</b> l'eventuale contenuto non è destinato al consumo. Vendita riservata ai maggiorenni.</p>\n` +
    `<p><i>Le foto fanno parte integrante della descrizione.</i></p>`
  );
}

function itemSpecificsXml(draft) {
  const pairs = [['Marca', 'Senza marca']];
  if (draft.epoca) pairs.push(['Epoca', draft.epoca]);
  if (draft.materiale) pairs.push(['Materiale', draft.materiale]);
  if (draft.colore) pairs.push(['Colore', draft.colore]);
  if (draft.altezzaCm) pairs.push(['Altezza', `${draft.altezzaCm} cm`]);
  const lists = pairs
    .map(
      ([n, v]) =>
        `<NameValueList><Name>${esc(n)}</Name><Value>${esc(String(v).slice(0, 65))}</Value></NameValueList>`
    )
    .join('');
  return `<ItemSpecifics>${lists}</ItemSpecifics>`;
}

// Pubblica l'inserzione a prezzo fisso. Restituisce { itemId, url }.
export async function publishListing(env, draft, pictureUrls) {
  const c = cfg(env);

  const price = Number(draft.prezzo);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Prezzo non valido: impostalo nella bozza prima di pubblicare.');
  }

  let categoryId = (env.EBAY_DEFAULT_CATEGORY_ID || '').trim();
  if (!categoryId && c.siteId === '101') {
    // Categoria sicura per bottiglie da collezione su eBay Italia. Il
    // suggerimento automatico va evitato qui: per i vini propone la categoria
    // 258852 "Cibi e bevande > Vini", che accetta solo condizione "Nuovo",
    // esige la gradazione alcolica ed è riservata ai venditori professionali.
    categoryId = '126800';
  }
  if (!categoryId) categoryId = await suggestCategory(env, draft.titolo);
  if (!categoryId) {
    throw new Error(
      'Non sono riuscito a trovare una categoria eBay in automatico: imposta EBAY_DEFAULT_CATEGORY_ID nel file .env (vedi README).'
    );
  }

  const shippingCost = Number(env.EBAY_SHIPPING_COST || '9.90');
  const shippingService = (env.EBAY_SHIPPING_SERVICE || 'IT_ExpressCourier').trim();
  const postalCode = (env.EBAY_POSTAL_CODE || '').trim();
  const location = (env.EBAY_ITEM_LOCATION || 'Italia').trim();

  const inner =
    `<Item>` +
    `<Title>${esc(String(draft.titolo).slice(0, 80))}</Title>` +
    `<Description><![CDATA[${descriptionHtml(draft)}]]></Description>` +
    `<PrimaryCategory><CategoryID>${esc(categoryId)}</CategoryID></PrimaryCategory>` +
    `<StartPrice currencyID="EUR">${price.toFixed(2)}</StartPrice>` +
    `<ConditionID>3000</ConditionID>` +
    `<ConditionDescription>${esc((draft.condizione || "Oggetto d'epoca usato, vedi foto e descrizione.").slice(0, 1000))}</ConditionDescription>` +
    `<Country>IT</Country>` +
    `<Currency>EUR</Currency>` +
    `<DispatchTimeMax>3</DispatchTimeMax>` +
    `<ListingDuration>GTC</ListingDuration>` +
    `<ListingType>FixedPriceItem</ListingType>` +
    `<Location>${esc(location)}</Location>` +
    (postalCode ? `<PostalCode>${esc(postalCode)}</PostalCode>` : '') +
    `<PictureDetails>${pictureUrls.map((u) => `<PictureURL>${esc(u)}</PictureURL>`).join('')}</PictureDetails>` +
    `<Quantity>1</Quantity>` +
    itemSpecificsXml(draft) +
    `<ReturnPolicy><ReturnsAcceptedOption>ReturnsNotAccepted</ReturnsAcceptedOption></ReturnPolicy>` +
    `<ShippingDetails>` +
    `<ShippingType>Flat</ShippingType>` +
    `<ShippingServiceOptions>` +
    `<ShippingServicePriority>1</ShippingServicePriority>` +
    `<ShippingService>${esc(shippingService)}</ShippingService>` +
    `<ShippingServiceCost currencyID="EUR">${shippingCost.toFixed(2)}</ShippingServiceCost>` +
    `</ShippingServiceOptions>` +
    `</ShippingDetails>` +
    `<Site>Italy</Site>` +
    `</Item>`;

  const xml = await tradingCall(env, 'AddFixedPriceItem', inner);
  const itemId = xmlText(xml, 'ItemID');
  if (!itemId) throw new Error("eBay non ha restituito l'ID dell'inserzione.");
  const url =
    c.environment === 'sandbox'
      ? `https://cgi.sandbox.ebay.it/ws/eBayISAPI.dll?ViewItem&item=${itemId}`
      : `https://www.ebay.it/itm/${itemId}`;
  return { itemId, url };
}
