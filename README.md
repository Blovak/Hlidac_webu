# Hlídání webu

Webová aplikace pro sledování změn veřejných internetových stránek. Frontend běží
na GitHub Pages, zatímco veškerá aplikační činnost probíhá v Google Apps Scriptu:

- ověření uživatele šestimístným kódem zaslaným e-mailem,
- samostatný list pojmenovaný e-mailem každého uživatele,
- evidence sledovaných URL v Google Sheetu,
- hodinový trigger pro kontroly,
- e-mailová upozornění s odkazem při změně obsahu.

## Architektura

```text
GitHub Pages (index.html)
          │ JSONP API
          ▼
Google Apps Script ── Google Sheet
          │
          ├── UrlFetchApp (kontrola veřejných stránek)
          └── MailApp (kódy a upozornění)
```

Použitý Google Sheet:
https://docs.google.com/spreadsheets/d/1Zfjx1yZ0DRI0G3LAkdRN1LWY227VV_yD6FIeMtNMQDo/edit

## Nasazený Google Apps Script

- Projekt: https://script.google.com/d/1mIJ4ELptyEkdeVOog7WFlrgpzt5kNOXawyPLkc1LuWDhSLM1kuCjBZI4/edit
- Produkční endpoint:
  https://script.google.com/macros/s/AKfycbw8_ns2VSvPq_zNJXgfBdl-k3X-6EZIy0FuhB4EVpwyza1byyc8GzDnTEm4ZXuyH5By0A/exec

Backend je již propojený v `app.js`. V nastavení nasazení musí být webová
aplikace spuštěná jako vlastník a přístupná komukoli.

Před prvním použitím otevřete projekt, zvolte funkci `setupProject`, klikněte
na **Spustit** a potvrďte požadovaná oprávnění Google. Bez tohoto jednorázového
souhlasu Google veřejné volání nového projektu odmítne.

## Nové nasazení Google Apps Scriptu

1. Vytvořte samostatný Apps Script projekt a nahrajte do něj soubory z adresáře
   `apps-script/`.
2. V editoru spusťte jednou funkci `setupProject` a potvrďte oprávnění. Funkce
   připraví systémový list `_Users` a hodinový trigger `checkAllSites`.
3. Zvolte **Nasadit → Nové nasazení → Webová aplikace**.
4. Nastavte:
   - **Spustit jako:** Já
   - **Kdo má přístup:** Kdokoli
5. Zkopírujte adresu končící `/exec`.
6. V `app.js` nahraďte stávající `apiUrl` novou adresou.

Při změně backendu vytvořte novou verzi nasazení. Vývojová adresa `/dev` není
pro GitHub Pages vhodná.

### Nasazení pomocí clasp

```bash
cd apps-script
clasp create --type standalone --title "Hlídání webu"
clasp push
clasp open
```

Ve webovém editoru pak proveďte kroky 2–5 výše. Soubor `.clasp.json` je záměrně
ignorován, protože obsahuje ID konkrétního Apps Script projektu.

## GitHub Pages

Workflow `.github/workflows/pages.yml` nasadí obsah kořene repozitáře po každém
pushi do větve `main`. Výsledná adresa:

https://blovak.github.io/Hlidac_webu/

## Datový model

List `_Users` je skrytý a uchovává pouze hash relace a její expiraci. Ověřovací
kód se v tabulce neukládá; jeho hash je dočasně uložen ve vlastnostech Apps
Scriptu a po 10 minutách pozbývá platnosti.

List každého uživatele se jmenuje přesně jeho normalizovaným e-mailem a obsahuje:

| Sloupec | Význam |
| --- | --- |
| ID | Stabilní ID záznamu |
| URL | Sledovaná stránka |
| IntervalValue / IntervalUnit | Uživatelský interval |
| IntervalHours | Interval přepočtený pro plánovač |
| Active | Zapnutí sledování |
| LastCheck / NextCheck | Časy kontroly |
| LastHash | SHA-256 otisk normalizovaného obsahu |
| LastHttpStatus | Poslední HTTP stav |
| LastChange | Poslední zachycená změna |
| CreatedAt | Datum vytvoření |
| LastError | Poslední chyba kontroly |
| LastContent | Interní snímek normalizovaného viditelného textu pro popis změny |

## Provozní poznámky

- Nejkratší podporovaný interval je jedna hodina, což odpovídá možnostem
  časových triggerů Apps Scriptu.
- U HTML se porovnává normalizovaný viditelný text. Skripty, styly, metadata,
  komentáře, prvky přímo označené jako skryté, značky a atributy HTML se
  ignorují, takže jejich technické změny samy o sobě upozornění nevyvolají.
- První úspěšná kontrola pouze uloží výchozí otisk a textový snímek; e-mail se
  odešle až při následující změně. Totéž platí pro první kontrolu po přechodu
  ze starší metodiky.
- Upozornění obsahuje okolní text a ukázku odebraného a přidaného obsahu.
- Kvůli omezení běhu Apps Scriptu se v jednom spuštění kontroluje nejvýše 50
  stránek. Další splatné kontroly se zpracují při příštím hodinovém běhu.
- Stránky závislé na JavaScriptu mohou vracet pouze základní HTML. Aplikace
  porovnává odpověď serveru, nikoli vykreslený DOM v prohlížeči.
- Některé weby automatické požadavky blokují; taková chyba se zobrazí u URL.

## Lokální kontrola frontendu

```bash
python3 -m http.server 8080
```

Potom otevřete `http://localhost:8080/Hlidac_webu/`.
