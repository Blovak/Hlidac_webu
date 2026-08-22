# Kontext projektu Hlídání webu

Aktualizováno: 22. srpna 2026

Tento soubor je hlavní předávací dokument pro pokračování vývoje a provozu
projektu. Neobsahuje hesla, OAuth tokeny ani jiné tajné údaje.

## Cíl projektu

Webová aplikace umožňuje uživateli:

1. přihlásit se pomocí e-mailu a šestimístného ověřovacího kódu,
2. přidat jednu nebo více veřejných URL,
3. nastavit interval kontroly v hodinách, dnech nebo týdnech,
4. pozastavit, upravit nebo odstranit sledování,
5. dostat e-mail s přímým odkazem, když se obsah stránky změní.

Pro každého uživatele vzniká v cílovém Google Sheetu samostatný list, jehož
název odpovídá normalizované e-mailové adrese uživatele.

## Produkční zdroje

| Zdroj | Hodnota |
| --- | --- |
| GitHub repozitář | https://github.com/Blovak/Hlidac_webu |
| Webová aplikace | https://blovak.github.io/Hlidac_webu/ |
| Větev | `main` |
| Commit aplikační implementace | `647f7739766cdea31ee998eeb19af604ef440ed3` |
| Google Sheet | https://docs.google.com/spreadsheets/d/1Zfjx1yZ0DRI0G3LAkdRN1LWY227VV_yD6FIeMtNMQDo/edit |
| Spreadsheet ID | `1Zfjx1yZ0DRI0G3LAkdRN1LWY227VV_yD6FIeMtNMQDo` |
| Apps Script projekt | https://script.google.com/d/1mIJ4ELptyEkdeVOog7WFlrgpzt5kNOXawyPLkc1LuWDhSLM1kuCjBZI4/edit |
| Apps Script ID | `1mIJ4ELptyEkdeVOog7WFlrgpzt5kNOXawyPLkc1LuWDhSLM1kuCjBZI4` |
| Produkční deployment | `AKfycbw8_ns2VSvPq_zNJXgfBdl-k3X-6EZIy0FuhB4EVpwyza1byyc8GzDnTEm4ZXuyH5By0A` |
| Apps Script endpoint | https://script.google.com/macros/s/AKfycbw8_ns2VSvPq_zNJXgfBdl-k3X-6EZIy0FuhB4EVpwyza1byyc8GzDnTEm4ZXuyH5By0A/exec |
| Aktuální verze deploymentu | `5` |

## Ověřený provozní stav

K 29. červenci 2026 bylo ověřeno:

- GitHub Pages workflow doběhl úspěšně.
- Produkční URL vrací aktuální `index.html` aplikace.
- Apps Script endpoint veřejně odpovídá na akci `ping`.
- Funkce `setupProject` byla vlastníkem spuštěna a oprávnění byla potvrzena.
- V Google Sheetu existuje skrytý systémový list `_Users`.
- Funkce `setupProject` zakládá hodinový trigger `checkAllSites`.
- Frontend prošel kontrolou JavaScriptové syntaxe a vizuální kontrolou na
  desktopovém i mobilním viewportu.

## Architektura

```text
GitHub Pages
  index.html + styles.css + app.js
              |
              | JSONP požadavky
              v
Google Apps Script web app
  - ověření e-mailu
  - správa relací
  - CRUD sledovaných URL
  - hodinový plánovač
  - načítání sledovaných webů
  - odesílání e-mailů
              |
              v
Google Sheet Hlidac_webu
  - _Users
  - jeden list pro každý e-mail
```

Backend používá výhradně služby Google Apps Script:

- `SpreadsheetApp`,
- `MailApp`,
- `UrlFetchApp`,
- `ScriptApp`,
- `PropertiesService`,
- `CacheService`,
- `LockService`,
- `Utilities`.

Není použit externí server, databáze ani autentizační služba.

## Soubory projektu

| Soubor | Účel |
| --- | --- |
| `index.html` | Struktura přihlášení, dashboardu a dialogu URL |
| `styles.css` | Responzivní vzhled aplikace |
| `app.js` | Frontendový stav, JSONP API, relace a CRUD |
| `apps-script/Code.js` | Celý Apps Script backend |
| `apps-script/appsscript.json` | Manifest, oprávnění a webapp konfigurace |
| `apps-script/.claspignore` | Výběr souborů nahrávaných přes clasp |
| `.github/workflows/pages.yml` | Automatické nasazení GitHub Pages |
| `README.md` | Instalační a provozní dokumentace |
| `PROJECT_CONTEXT.md` | Tento předávací kontext |

Lokální soubor `apps-script/.clasp.json` je záměrně ignorovaný Gitem. Obsahuje
ID Apps Script projektu, ale není potřeba ho publikovat.

## Backendové API

Všechny operace se volají metodou GET přes JSONP. Parametr `callback` musí být
platný JavaScriptový identifikátor.

| Akce | Autentizace | Účel |
| --- | --- | --- |
| `ping` | ne | Kontrola dostupnosti |
| `requestCode` | ne | Odeslání šestimístného kódu |
| `verifyCode` | kód | Ověření kódu a vydání relace |
| `listUrls` | token | Načtení URL uživatele |
| `addUrl` | token | Přidání URL |
| `updateUrl` | token | Úprava URL nebo intervalu |
| `deleteUrl` | token | Odstranění URL |
| `logout` | token | Zneplatnění relace |

Relace se ukládá ve frontendovém `localStorage` pod klíčem
`hlidaniWebuSession`. Server uchovává pouze hash tokenu.

## Ověření e-mailu a relace

- Kód má přesně šest číslic.
- Platnost kódu je 10 minut.
- Nový kód lze pro stejný e-mail vyžádat nejvýše jednou za minutu.
- Po pěti neúspěšných pokusech se kód zneplatní.
- Vlastní kód se neukládá; v `PropertiesService` je pouze jeho hash.
- Relace platí 30 dní.
- V `_Users` je pouze hash relace, expirace a čas ověření.
- Pokud uživatel nemá platnou místní relaci, musí znovu ověřit e-mail kódem.

## Datový model uživatelského listu

Každý uživatelský list má tyto sloupce:

1. `ID`
2. `URL`
3. `IntervalValue`
4. `IntervalUnit`
5. `IntervalHours`
6. `Active`
7. `LastCheck`
8. `NextCheck`
9. `LastHash`
10. `LastHttpStatus`
11. `LastChange`
12. `CreatedAt`
13. `LastError`
14. `LastContent`

Podporované jednotky jsou `hours`, `days` a `weeks`. Nejkratší interval je
jedna hodina.

## Detekce změn

- První úspěšná kontrola vytvoří výchozí SHA-256 otisk a neposílá upozornění.
- U HTML odpovědí se před výpočtem hashe ponechá normalizovaný viditelný text.
  Ignorují se komentáře, hlavička dokumentu, skripty, styly, šablony, SVG,
  přímo skryté prvky, značky a atributy HTML i rozdíly v bílých znacích.
- Omezený textový snímek se ukládá do `LastContent`. Při změně se z něj určí
  okolní text a ukázky odebraného a přidaného obsahu pro e-mail.
- Starší listy se automaticky rozšíří o `LastContent`; první kontrola po migraci
  pouze vytvoří nový výchozí stav a neposílá upozornění.
- U netextových odpovědí se počítá hash bajtového obsahu.
- Při rozdílném hashi odešle `MailApp` e-mail s přímým odkazem.
- Stav HTTP mimo rozsah 200–399 se uloží jako chyba.
- V jednom běhu se zpracuje nejvýše 50 splatných kontrol.
- Běh se ukončuje před limitem Apps Scriptu přibližně po 4,5 minutách.

JavaScriptově vykreslované weby se porovnávají podle serverové odpovědi, nikoli
podle DOM vykresleného v prohlížeči.

## Bezpečnost

- URL musí začínat `http://` nebo `https://`.
- Jsou blokované lokální, privátní a metadata adresy.
- URL nesmí obsahovat přihlašovací údaje.
- E-mail musí být použitelný jako přesný název listu Google Sheets.
- Změny dat používají `LockService`.
- Frontend používá Content Security Policy.
- Uživatelská data se vkládají do DOM přes `textContent`.
- JSONP token se posílá pouze na důvěryhodný Apps Script endpoint.
- V repozitáři nesmí být OAuth tokeny, přístupové kódy ani `APP_SECRET`.

## Nasazení změn

### Frontend

Změny ve větvi `main` automaticky nasazuje workflow
`.github/workflows/pages.yml`. Po publikaci ověřit:

1. stav GitHub Actions,
2. obsah `https://blovak.github.io/Hlidac_webu/`,
3. načtení `styles.css` a `app.js`.

### Backend

Z adresáře `apps-script/`:

```bash
clasp push --force
clasp deploy \
  --deploymentId AKfycbw8_ns2VSvPq_zNJXgfBdl-k3X-6EZIy0FuhB4EVpwyza1byyc8GzDnTEm4ZXuyH5By0A \
  --description "Veřejná produkční webová aplikace"
```

Při vytvoření nového deploymentu je nutné aktualizovat:

1. `APP_CONFIG.apiUrl` v `app.js`,
2. produkční údaje v `README.md`,
3. produkční údaje v tomto souboru.

Manifest webové aplikace musí zachovat:

```json
{
  "webapp": {
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING"
  }
}
```

## Důležité provozní poznámky

- Google Sheet měl při poslední kontrole locale `cs_CZ` a časovou zónu
  `Etc/GMT`; Apps Script používá `Europe/Prague`.
- Apps Script a odesílání e-mailů podléhají denním kvótám vlastníka.
- Dynamické stránky mohou vytvářet časté změny nebo naopak vracet pouze
  základní HTML.
- Některé weby blokují automatické požadavky Google `UrlFetchApp`.
- Při větším počtu URL se splatné kontroly mohou přesunout do dalšího
  hodinového běhu.

## Doporučený postup při navázání

1. Přečíst tento soubor a `README.md`.
2. Ověřit aktuální větev a stav repozitáře.
3. Ověřit produkční `ping`.
4. Před změnou backendu zkontrolovat aktuální deployment a kvóty Apps Scriptu.
5. Zachovat požadavek, že aplikační činnosti používají pouze Google Apps.
6. Po změnách vždy znovu ověřit GitHub Pages i Apps Script endpoint.
