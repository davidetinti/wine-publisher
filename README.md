# 🍾 Bottle Publisher

Dalla foto all'annuncio in un minuto: scatti le foto di una bottiglia antica dal
telefono, l'AI scrive **titolo, descrizione e prezzo**, e l'app **pubblica su
eBay** in automatico. Per i portali senza API pubblica (Subito.it, Vinted,
Facebook Marketplace, Wallapop) l'annuncio è pronto da **copiare e incollare**
con un tap.

**Costo: zero.** Nessuna dipendenza da installare (serve solo Node.js, già
presente sul PC), API Gemini gratuita, API eBay gratuite.

---

## Come funziona

1. Avvii il server sul PC (`node server.js`)
2. Apri l'indirizzo mostrato **dal telefono** (stessa rete Wi-Fi)
3. Scatti/scegli le foto della bottiglia → **✨ Genera annuncio**
4. L'AI (Google Gemini) analizza le foto e compila titolo, descrizione,
   prezzo consigliato, epoca, materiale, colore... e **decide se vale la pena
   venderla**:
   - se sì → l'annuncio viene **pubblicato su eBay automaticamente**, senza
     altri passaggi
   - se no (bottiglia comune, senza valore, foto poco chiare, prezzo sotto
     soglia) → resta in **bozza con la motivazione**, e puoi comunque
     pubblicarlo a mano con "Pubblica comunque"
5. Per gli altri portali (Subito/Vinted/ecc.) copi il testo pronto con un tap.

La pubblicazione automatica si regola nel `.env`:

```
AUTO_PUBLISH=true              # false = tutto resta in bozza, decidi sempre tu
AUTO_PUBLISH_MIN_PRICE=8       # niente auto-pubblicazione sotto questo prezzo stimato
```

Tutte le bozze e le foto restano salvate sul PC nella cartella `data/`.

---

## Configurazione (una volta sola)

### 1. Chiave Gemini (gratis, 2 minuti)

1. Vai su **https://aistudio.google.com/apikey** (basta un account Google)
2. Clicca **"Create API key"** e copia la chiave

### 2. Chiavi eBay (gratis, ~15 minuti)

1. Registrati su **https://developer.ebay.com** (account sviluppatore gratuito;
   usa lo stesso account eBay con cui vendi, o collegalo dopo)
2. Vai su **Your Account → Application Keys** e crea un keyset **Production**.
   Ti servono tre valori: **App ID (Client ID)**, **Dev ID**, **Cert ID**
3. Vai su **Your Account → User Tokens** (o "eBay Sign-in / Tokens"), scegli
   l'ambiente **Production**, seleziona **Auth'n'Auth** e clicca
   **"Sign in to Production"**: accedi con il tuo account eBay venditore e
   copia il **token utente** generato (è lungo, inizia in genere per `AgAAA...`
   ed è valido circa 18 mesi)

> Nota: per vendere su eBay il tuo account deve essere abilitato alla vendita
> (dati di pagamento configurati su ebay.it). È il normale account venditore,
> nessun costo per creare l'inserzione base.

### 3. File `.env`

Nella cartella dell'app, copia `.env.example` in `.env`:

```
copy .env.example .env
```

Aprilo con il Blocco note e incolla le chiavi:

```
GEMINI_API_KEY=la-tua-chiave-gemini
EBAY_APP_ID=...
EBAY_DEV_ID=...
EBAY_CERT_ID=...
EBAY_USER_TOKEN=AgAAA...
EBAY_POSTAL_CODE=il-tuo-cap
EBAY_ITEM_LOCATION=la-tua-città
EBAY_SHIPPING_COST=9.90
```

Per **fare prove senza pubblicare davvero**: crea anche il keyset e il token
**Sandbox** su developer.ebay.com e metti `EBAY_ENV=sandbox` nel `.env`
(ricordati di rimettere `production` quando fai sul serio).

---

## Avvio

```
node server.js
```

Il terminale mostra qualcosa come:

```
🍾 Bottle Publisher avviato!
   Sul PC:        http://localhost:3000
   Dal telefono:  http://192.168.1.42:3000   (rete "Wi-Fi")
```

Apri l'indirizzo "Dal telefono" nel browser del telefono (stessa rete Wi-Fi).
Consiglio: aggiungilo alla schermata Home per averlo come un'app.

> **Windows Firewall**: al primo avvio Windows chiede se consentire a Node.js
> l'accesso alla rete → consenti su **reti private**, altrimenti il telefono
> non raggiunge il PC.

---

## Domande frequenti / problemi

**Perché eBay sì e Subito/Vinted/Facebook no?**
eBay è l'unico dei grandi portali con API pubbliche e gratuite per creare
inserzioni. Subito.it, Vinted, Wallapop e Facebook Marketplace non offrono API
pubbliche di inserimento (e automatizzarli via bot violerebbe i loro termini
d'uso, con rischio ban dell'account). Per questi l'app prepara il testo pronto
da incollare: con "Apri portale →" e i pulsanti "Copia" ci vogliono ~30 secondi
ad annuncio, foto già sul telefono.

**Errore sulla spedizione durante la pubblicazione**
Il codice del servizio di spedizione predefinito è `IT_ExpressCourier`. Se eBay
lo rifiuta, apri sul PC `http://localhost:3000/api/ebay/shipping-services`:
vedrai la lista dei codici validi. Copia quello che preferisci in
`EBAY_SHIPPING_SERVICE` nel `.env` e riavvia il server.

**Errore sulla categoria**
L'app chiede a eBay una categoria adatta in base al titolo. Se fallisce o la
categoria proposta richiede dati particolari, imposta tu la categoria fissa:
cerca su ebay.it una bottiglia simile, apri la sua categoria e prendi il numero
che compare nell'URL (parametro tipo `_sacat=XXXXX`), poi mettilo in
`EBAY_DEFAULT_CATEGORY_ID` nel `.env`.

**E se Gemini esaurisce le richieste gratuite?**
Ogni modello del piano gratuito ha un tetto di richieste al minuto e al giorno,
ma l'app usa una **catena di modelli con fallback automatico**: se il primo
risponde "quota esaurita", lo mette in pausa (per il tempo di attesa che Google
stessa indica) e passa al successivo, e così via. La catena si regola nel
`.env` in ordine di priorità:

```
GEMINI_MODELS=gemini-3.5-flash,gemini-3-flash-preview,gemini-2.5-flash,gemini-2.5-flash-lite,gemini-3.1-flash-lite,gemma-4-31b-it
```

I primi sono i più precisi (~20 richieste gratuite al giorno ciascuno); in
fondo ci sono le grandi riserve: `gemini-3.1-flash-lite` (500/giorno) e
`gemma-4-31b-it` (1500/giorno). In totale oltre 2000 analisi al giorno:
in pratica non resti mai a piedi. Nella bozza vedi sempre quale modello ha
generato l'annuncio. Solo se TUTTI i modelli sono esauriti l'app mostra un
errore con l'orario in cui riprovare.

**Il telefono non si collega**
Verifica che PC e telefono siano sulla **stessa rete Wi-Fi** e che il firewall
di Windows consenta Node.js sulle reti private.

**Il prezzo proposto è affidabile?**
È una stima dell'AI basata sulle foto, pensata come punto di partenza: sei tu a
confermarlo o modificarlo prima di pubblicare. Per pezzi che sospetti di valore,
controlla i "venduti" su eBay prima di accettare la cifra.

**Dove sono i miei dati?**
Tutto in locale: bozze in `data/drafts.json`, foto in `data/photos/`. Le foto
vengono inviate solo a Google (analisi) e a eBay (pubblicazione).

---

## Deploy su un server (Docker + GitHub Actions)

L'app è containerizzata: a ogni push su `main`, GitHub Actions costruisce
l'immagine Docker, la pubblica su GitHub Container Registry (`ghcr.io`) e fa il
deploy sul tuo server via SSH.

### 1. Pubblica su GitHub (una volta sola)

Crea un repository (consigliato **privato**) su https://github.com/new
chiamato `ebay-publisher`, poi dal PC:

```
git remote add origin https://github.com/TUO-UTENTE/ebay-publisher.git
git push -u origin main
```

Il push fa già partire la build dell'immagine (visibile nella scheda
**Actions** del repository). Il deploy viene saltato finché non configuri i
segreti del punto 3.

### 2. Prepara il server (una volta sola)

Sul server (serve Docker installato):

```
mkdir -p ~/bottle-publisher && cd ~/bottle-publisher
# copia qui docker-compose.yml (sostituendo TUO-UTENTE-GITHUB) e crea il
# file .env con le tue chiavi, IMPOSTANDO ANCHE APP_PASSWORD
```

Se il repository è privato, anche l'immagine su ghcr.io è privata: il server
deve autenticarsi una volta con un token (su GitHub: Settings → Developer
settings → Personal access tokens, permesso `read:packages`):

```
docker login ghcr.io -u TUO-UTENTE -p IL_TOKEN
```

### 3. Configura i segreti per il deploy automatico

Nel repository GitHub: **Settings → Secrets and variables → Actions** →
aggiungi:

| Segreto | Valore |
|---|---|
| `DEPLOY_HOST` | IP o hostname del server |
| `DEPLOY_USER` | utente SSH (es. `ubuntu`) |
| `DEPLOY_SSH_KEY` | chiave SSH **privata** che accede al server |
| `DEPLOY_PORT` | (opzionale) porta SSH se diversa da 22 |

Da quel momento ogni `git push` aggiorna il server da solo. Puoi anche
lanciare il deploy a mano da **Actions → Build e Deploy → Run workflow**.

### Note importanti per l'esposizione su internet

- **Imposta `APP_USER` e `APP_PASSWORD`** nel `.env` del server: senza,
  chiunque trovi l'indirizzo può usare la tua chiave Gemini e pubblicare su
  eBay a nome tuo. Il browser chiederà le credenziali alla prima visita
  (finestra di login standard) e le ricorderà.
- La password viaggia in chiaro su HTTP: se il server è raggiungibile da
  internet metti davanti un reverse proxy con HTTPS (es. Caddy: due righe di
  configurazione e il certificato è automatico) oppure raggiungi il server
  solo via VPN (es. WireGuard/Tailscale).
- I dati (bozze e foto) vivono nel volume Docker `bottle_data` e sopravvivono
  agli aggiornamenti.

## Struttura del progetto

```
server.js          server web (Node puro, zero dipendenze)
lib/env.js         lettura del file .env
lib/store.js       salvataggio bozze e foto in data/
lib/gemini.js      analisi foto → annuncio (Google Gemini, gratis)
lib/ebay.js        upload foto + pubblicazione (eBay Trading API, gratis)
public/            interfaccia web per il telefono
.env               le TUE chiavi (non condividerlo mai)
```
