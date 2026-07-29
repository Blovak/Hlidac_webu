"use strict";

const CONFIG = Object.freeze({
  spreadsheetId: "1Zfjx1yZ0DRI0G3LAkdRN1LWY227VV_yD6FIeMtNMQDo",
  appName: "Hlídání webu",
  frontendUrl: "https://blovak.github.io/Hlidac_webu/",
  codeTtlSeconds: 600,
  codeRequestCooldownSeconds: 60,
  maxCodeAttempts: 5,
  sessionTtlDays: 30,
  maxChecksPerRun: 50,
  maxRuntimeMs: 4.5 * 60 * 1000,
  userSheetHeaders: [
    "ID",
    "URL",
    "IntervalValue",
    "IntervalUnit",
    "IntervalHours",
    "Active",
    "LastCheck",
    "NextCheck",
    "LastHash",
    "LastHttpStatus",
    "LastChange",
    "CreatedAt",
    "LastError",
  ],
  usersSheetName: "_Users",
  usersHeaders: ["Email", "TokenHash", "TokenExpiresAt", "VerifiedAt", "CreatedAt"],
});

function doGet(event) {
  const parameters = (event && event.parameter) || {};
  const callback = parameters.callback || "";

  try {
    const data = dispatch_(parameters);
    return jsonpResponse_(callback, { ok: true, data: data || {} });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonpResponse_(callback, {
      ok: false,
      error: {
        code: error.code || "SERVER_ERROR",
        message: publicErrorMessage_(error),
      },
    });
  }
}

function dispatch_(parameters) {
  switch (parameters.action) {
    case "ping":
      return { service: CONFIG.appName, time: new Date().toISOString() };
    case "requestCode":
      return requestCode_(parameters.email);
    case "verifyCode":
      return verifyCode_(parameters.email, parameters.code);
    case "listUrls":
      return listUrls_(requireSession_(parameters.token));
    case "addUrl":
      return addUrl_(requireSession_(parameters.token), parameters);
    case "updateUrl":
      return updateUrl_(requireSession_(parameters.token), parameters);
    case "deleteUrl":
      return deleteUrl_(requireSession_(parameters.token), parameters.id);
    case "logout":
      return logout_(parameters.token);
    default:
      throw apiError_("UNKNOWN_ACTION", "Neznámá operace.");
  }
}

function setupProject() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSystemSetup_();
    ensureHourlyTrigger_();
  } finally {
    lock.releaseLock();
  }
  return "Projekt je připravený.";
}

function requestCode_(rawEmail) {
  const email = normalizeEmail_(rawEmail);
  assertEmailCanBeSheetName_(email);
  ensureSystemSetup_();

  const cache = CacheService.getScriptCache();
  const rateKey = "code-rate-" + sha256_(email).slice(0, 32);
  if (cache.get(rateKey)) {
    throw apiError_("RATE_LIMITED", "Nový kód lze poslat nejvýše jednou za minutu.");
  }

  const code = generateSixDigitCode_();
  const verification = {
    hash: secretHash_("code|" + email + "|" + code),
    expiresAt: Date.now() + CONFIG.codeTtlSeconds * 1000,
    attempts: 0,
  };

  PropertiesService.getScriptProperties().setProperty(
    verificationKey_(email),
    JSON.stringify(verification)
  );
  cache.put(rateKey, "1", CONFIG.codeRequestCooldownSeconds);

  MailApp.sendEmail({
    to: email,
    subject: "Váš ověřovací kód pro Hlídání webu",
    body:
      "Váš ověřovací kód je: " + code + "\n\n" +
      "Kód platí 10 minut. Pokud jste o něj nežádali, tento e-mail ignorujte.\n\n" +
      CONFIG.appName + "\n" + CONFIG.frontendUrl,
    htmlBody:
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px">' +
      '<p style="color:#2563eb;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Hlídání webu</p>' +
      '<h1 style="color:#0f172a;font-size:26px">Ověření e-mailu</h1>' +
      '<p style="color:#475569;line-height:1.6">Pro dokončení přihlášení zadejte tento šestimístný kód:</p>' +
      '<div style="margin:24px 0;padding:18px;border-radius:12px;background:#eff6ff;color:#0f172a;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center">' +
      escapeHtml_(code) +
      '</div>' +
      '<p style="color:#64748b;font-size:13px">Kód platí 10 minut. Pokud jste o něj nežádali, e-mail ignorujte.</p>' +
      "</div>",
    name: CONFIG.appName,
  });

  return { sent: true, expiresInSeconds: CONFIG.codeTtlSeconds };
}

function verifyCode_(rawEmail, rawCode) {
  const email = normalizeEmail_(rawEmail);
  const code = String(rawCode || "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw apiError_("INVALID_CODE", "Ověřovací kód musí mít 6 číslic.");
  }

  const properties = PropertiesService.getScriptProperties();
  const key = verificationKey_(email);
  const storedValue = properties.getProperty(key);
  if (!storedValue) {
    throw apiError_("CODE_EXPIRED", "Kód není platný. Nechte si poslat nový.");
  }

  const verification = JSON.parse(storedValue);
  if (Date.now() > Number(verification.expiresAt)) {
    properties.deleteProperty(key);
    throw apiError_("CODE_EXPIRED", "Platnost kódu vypršela. Nechte si poslat nový.");
  }

  verification.attempts = Number(verification.attempts || 0) + 1;
  if (verification.attempts > CONFIG.maxCodeAttempts) {
    properties.deleteProperty(key);
    throw apiError_("TOO_MANY_ATTEMPTS", "Příliš mnoho pokusů. Nechte si poslat nový kód.");
  }

  if (verification.hash !== secretHash_("code|" + email + "|" + code)) {
    properties.setProperty(key, JSON.stringify(verification));
    throw apiError_("INVALID_CODE", "Zadaný kód není správný.");
  }

  properties.deleteProperty(key);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSystemSetup_();
    ensureUserSheet_(email);
    const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    upsertUserSession_(email, token);
    ensureHourlyTrigger_();
    return { token: token, email: email, expiresInDays: CONFIG.sessionTtlDays };
  } finally {
    lock.releaseLock();
  }
}

function listUrls_(email) {
  const sheet = ensureUserSheet_(email);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { urls: [] };

  const rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.userSheetHeaders.length).getValues();
  return {
    urls: rows
      .filter(function (row) { return row[0] && row[1]; })
      .map(rowToUrlObject_),
  };
}

function addUrl_(email, parameters) {
  const input = validateUrlInput_(parameters);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureUserSheet_(email);
    const now = new Date();
    const id = Utilities.getUuid();
    sheet.appendRow([
      id,
      input.url,
      input.intervalValue,
      input.intervalUnit,
      input.intervalHours,
      input.active,
      "",
      input.active ? now : "",
      "",
      "",
      "",
      now,
      "",
    ]);
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}

function updateUrl_(email, parameters) {
  const id = String(parameters.id || "");
  if (!id) throw apiError_("INVALID_ID", "Chybí identifikátor záznamu.");
  const input = validateUrlInput_(parameters);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureUserSheet_(email);
    const rowNumber = findRowById_(sheet, id);
    if (!rowNumber) throw apiError_("NOT_FOUND", "Sledovaná stránka nebyla nalezena.");
    const existing = sheet.getRange(rowNumber, 1, 1, CONFIG.userSheetHeaders.length).getValues()[0];
    const now = new Date();
    const urlChanged = existing[1] !== input.url;
    sheet.getRange(rowNumber, 1, 1, CONFIG.userSheetHeaders.length).setValues([[
      id,
      input.url,
      input.intervalValue,
      input.intervalUnit,
      input.intervalHours,
      input.active,
      existing[6],
      input.active ? now : "",
      urlChanged ? "" : existing[8],
      urlChanged ? "" : existing[9],
      urlChanged ? "" : existing[10],
      existing[11] || now,
      "",
    ]]);
    return { updated: true };
  } finally {
    lock.releaseLock();
  }
}

function deleteUrl_(email, id) {
  const safeId = String(id || "");
  if (!safeId) throw apiError_("INVALID_ID", "Chybí identifikátor záznamu.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureUserSheet_(email);
    const rowNumber = findRowById_(sheet, safeId);
    if (!rowNumber) throw apiError_("NOT_FOUND", "Sledovaná stránka nebyla nalezena.");
    sheet.deleteRow(rowNumber);
    return { deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function logout_(token) {
  if (!token) return { loggedOut: true };
  const usersSheet = getSpreadsheet_().getSheetByName(CONFIG.usersSheetName);
  if (!usersSheet || usersSheet.getLastRow() < 2) return { loggedOut: true };
  const tokenHash = secretHash_("session|" + token);
  const rows = usersSheet.getRange(2, 1, usersSheet.getLastRow() - 1, CONFIG.usersHeaders.length).getValues();
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index][1] === tokenHash) {
      usersSheet.getRange(index + 2, 2, 1, 2).clearContent();
      break;
    }
  }
  return { loggedOut: true };
}

function checkAllSites() {
  const startedAt = Date.now();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  try {
    const spreadsheet = getSpreadsheet_();
    const now = new Date();
    let checked = 0;
    const sheets = spreadsheet.getSheets().filter(function (sheet) {
      return sheet.getName().charAt(0) !== "_";
    });

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
      if (checked >= CONFIG.maxChecksPerRun || Date.now() - startedAt > CONFIG.maxRuntimeMs) break;
      const sheet = sheets[sheetIndex];
      if (!looksLikeUserSheet_(sheet)) continue;
      const email = sheet.getName();
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;
      const rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.userSheetHeaders.length).getValues();

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        if (checked >= CONFIG.maxChecksPerRun || Date.now() - startedAt > CONFIG.maxRuntimeMs) break;
        const row = rows[rowIndex];
        const active = row[5] === true || String(row[5]).toLowerCase() === "true";
        const nextCheck = asDate_(row[7]);
        if (!active || (nextCheck && nextCheck.getTime() > now.getTime())) continue;
        checkOneSite_(sheet, rowIndex + 2, row, email, now);
        checked += 1;
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function checkOneSite_(sheet, rowNumber, row, email, now) {
  const url = String(row[1] || "");
  const intervalHours = Math.max(1, Number(row[4]) || 1);
  const nextCheck = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);
  let hash = String(row[8] || "");
  let status = "";
  let lastChange = row[10] || "";
  let errorMessage = "";

  try {
    assertSafePublicUrl_(url);
    const response = UrlFetchApp.fetch(url, {
      followRedirects: true,
      muteHttpExceptions: true,
      validateHttpsCertificates: true,
      headers: {
        "User-Agent": "HlidacWebu/1.0 (+https://blovak.github.io/Hlidac_webu/)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    status = response.getResponseCode();
    if (status < 200 || status >= 400) {
      throw new Error("HTTP " + status);
    }

    const newHash = responseHash_(response);
    if (hash && hash !== newHash) {
      sendChangeNotification_(email, url, now);
      lastChange = now;
    }
    hash = newHash;
  } catch (error) {
    errorMessage = truncate_(String(error && error.message ? error.message : error), 350);
  }

  sheet.getRange(rowNumber, 7, 1, 7).setValues([[
    now,
    nextCheck,
    hash,
    status,
    lastChange,
    row[11] || now,
    errorMessage,
  ]]);
}

function sendChangeNotification_(email, url, changedAt) {
  const safeUrl = escapeHtml_(url);
  const formattedDate = Utilities.formatDate(
    changedAt,
    Session.getScriptTimeZone() || "Europe/Prague",
    "d. M. yyyy HH:mm"
  );
  MailApp.sendEmail({
    to: email,
    subject: "Změna stránky: " + truncate_(url, 90),
    body:
      "Na sledované stránce byla zachycena změna.\n\n" +
      url + "\n\n" +
      "Zachyceno: " + formattedDate + "\n\n" +
      "Správa sledování: " + CONFIG.frontendUrl,
    htmlBody:
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px">' +
      '<p style="color:#2563eb;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Hlídání webu</p>' +
      '<h1 style="color:#0f172a;font-size:25px">Na stránce se něco změnilo</h1>' +
      '<p style="color:#475569;line-height:1.6">Změnu jsme zachytili ' + escapeHtml_(formattedDate) + ".</p>" +
      '<p><a href="' + safeUrl + '" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#0f172a;color:white;font-weight:bold;text-decoration:none">Otevřít změněnou stránku</a></p>' +
      '<p style="margin-top:24px;color:#64748b;font-size:12px;word-break:break-all">' + safeUrl + "</p>" +
      "</div>",
    name: CONFIG.appName,
  });
}

function ensureSystemSetup_() {
  const spreadsheet = getSpreadsheet_();
  let usersSheet = spreadsheet.getSheetByName(CONFIG.usersSheetName);
  if (!usersSheet) {
    usersSheet = spreadsheet.insertSheet(CONFIG.usersSheetName);
    usersSheet.getRange(1, 1, 1, CONFIG.usersHeaders.length).setValues([CONFIG.usersHeaders]);
    styleHeader_(usersSheet, CONFIG.usersHeaders.length);
    usersSheet.setFrozenRows(1);
    usersSheet.hideSheet();
  }
  ensureSecret_();
}

function ensureHourlyTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "checkAllSites";
  });
  if (!exists) {
    ScriptApp.newTrigger("checkAllSites").timeBased().everyHours(1).create();
  }
}

function ensureUserSheet_(email) {
  assertEmailCanBeSheetName_(email);
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(email);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(email);
    sheet.getRange(1, 1, 1, CONFIG.userSheetHeaders.length).setValues([CONFIG.userSheetHeaders]);
    styleHeader_(sheet, CONFIG.userSheetHeaders.length);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 250);
    sheet.setColumnWidth(2, 380);
    sheet.getRange("G:H").setNumberFormat("dd.MM.yyyy HH:mm");
    sheet.getRange("K:L").setNumberFormat("dd.MM.yyyy HH:mm");
  } else if (!looksLikeUserSheet_(sheet)) {
    throw apiError_("SHEET_CONFLICT", "List s názvem tohoto e-mailu již existuje, ale nemá očekávanou strukturu.");
  }
  return sheet;
}

function styleHeader_(sheet, columnCount) {
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground("#0f172a")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
}

function looksLikeUserSheet_(sheet) {
  if (sheet.getLastColumn() < CONFIG.userSheetHeaders.length || sheet.getLastRow() < 1) return false;
  const headers = sheet.getRange(1, 1, 1, CONFIG.userSheetHeaders.length).getValues()[0];
  return CONFIG.userSheetHeaders.every(function (header, index) {
    return headers[index] === header;
  });
}

function upsertUserSession_(email, token) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.usersSheetName);
  const now = new Date();
  const expiry = new Date(now.getTime() + CONFIG.sessionTtlDays * 24 * 60 * 60 * 1000);
  const tokenHash = secretHash_("session|" + token);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let index = 0; index < emails.length; index += 1) {
      if (String(emails[index][0]).toLowerCase() === email) {
        const createdAt = sheet.getRange(index + 2, 5).getValue() || now;
        sheet.getRange(index + 2, 1, 1, CONFIG.usersHeaders.length)
          .setValues([[email, tokenHash, expiry, now, createdAt]]);
        return;
      }
    }
  }
  sheet.appendRow([email, tokenHash, expiry, now, now]);
}

function requireSession_(token) {
  if (!token || String(token).length < 40) {
    throw apiError_("UNAUTHORIZED", "Přihlášení není platné.");
  }
  ensureSystemSetup_();
  const usersSheet = getSpreadsheet_().getSheetByName(CONFIG.usersSheetName);
  const lastRow = usersSheet.getLastRow();
  if (lastRow < 2) throw apiError_("UNAUTHORIZED", "Přihlášení není platné.");
  const tokenHash = secretHash_("session|" + token);
  const rows = usersSheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index][1] === tokenHash) {
      const expiry = asDate_(rows[index][2]);
      if (!expiry || expiry.getTime() <= Date.now()) {
        usersSheet.getRange(index + 2, 2, 1, 2).clearContent();
        break;
      }
      return normalizeEmail_(rows[index][0]);
    }
  }
  throw apiError_("UNAUTHORIZED", "Platnost přihlášení vypršela.");
}

function validateUrlInput_(parameters) {
  const url = String(parameters.url || "").trim();
  assertSafePublicUrl_(url);
  const intervalValue = Number(parameters.intervalValue);
  const intervalUnit = String(parameters.intervalUnit || "");
  if (!Number.isInteger(intervalValue) || intervalValue < 1 || intervalValue > 8760) {
    throw apiError_("INVALID_INTERVAL", "Interval musí být celé číslo od 1 do 8760.");
  }
  const multipliers = { hours: 1, days: 24, weeks: 168 };
  if (!multipliers[intervalUnit]) {
    throw apiError_("INVALID_INTERVAL", "Jednotka intervalu není platná.");
  }
  return {
    url: url,
    intervalValue: intervalValue,
    intervalUnit: intervalUnit,
    intervalHours: intervalValue * multipliers[intervalUnit],
    active: String(parameters.active).toLowerCase() !== "false",
  };
}

function assertSafePublicUrl_(url) {
  if (url.length < 10 || url.length > 2000 || !/^https?:\/\/[^/\s]+/i.test(url)) {
    throw apiError_("INVALID_URL", "Zadejte platnou veřejnou HTTP nebo HTTPS adresu.");
  }
  const authorityMatch = url.match(/^https?:\/\/([^/]+)/i);
  const authority = authorityMatch ? authorityMatch[1] : "";
  if (authority.indexOf("@") !== -1) {
    throw apiError_("INVALID_URL", "Adresa nesmí obsahovat přihlašovací údaje.");
  }
  const hostname = authority.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    /^(10|127|169\.254|192\.168)\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw apiError_("INVALID_URL", "Lokální a privátní adresy nelze sledovat.");
  }
}

function responseHash_(response) {
  const headers = response.getAllHeaders();
  const contentType = String(headers["Content-Type"] || headers["content-type"] || "").toLowerCase();
  let content;
  if (contentType.indexOf("text/") !== -1 || contentType.indexOf("html") !== -1 || contentType.indexOf("json") !== -1) {
    content = normalizeTextContent_(response.getContentText());
  } else {
    content = response.getBlob().getBytes();
  }
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, content);
  return digest.map(function (byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
}

function normalizeTextContent_(content) {
  return String(content)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rowToUrlObject_(row) {
  return {
    id: String(row[0]),
    url: String(row[1]),
    intervalValue: Number(row[2]),
    intervalUnit: String(row[3]),
    intervalHours: Number(row[4]),
    active: row[5] === true || String(row[5]).toLowerCase() === "true",
    lastCheck: isoDate_(row[6]),
    nextCheck: isoDate_(row[7]),
    lastHttpStatus: row[9] === "" ? null : Number(row[9]),
    lastChange: isoDate_(row[10]),
    createdAt: isoDate_(row[11]),
    lastError: String(row[12] || ""),
  };
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(id)
    .matchEntireCell(true)
    .findNext();
  return finder ? finder.getRow() : 0;
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.spreadsheetId);
}

function normalizeEmail_(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    throw apiError_("INVALID_EMAIL", "Zadejte platnou e-mailovou adresu.");
  }
  return email;
}

function assertEmailCanBeSheetName_(email) {
  if (/[:\\/?*\[\]]/.test(email) || email.length > 100) {
    throw apiError_(
      "UNSUPPORTED_EMAIL",
      "Tento e-mail obsahuje znak, který Google Sheets nepovoluje v názvu listu."
    );
  }
}

function verificationKey_(email) {
  return "verification-" + sha256_(email);
}

function ensureSecret_() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty("APP_SECRET")) {
    properties.setProperty(
      "APP_SECRET",
      Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()
    );
  }
}

function secretHash_(value) {
  ensureSecret_();
  return sha256_(PropertiesService.getScriptProperties().getProperty("APP_SECRET") + "|" + value);
}

function sha256_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return digest.map(function (byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ("0" + normalized.toString(16)).slice(-2);
  }).join("");
}

function generateSixDigitCode_() {
  const digest = sha256_(Utilities.getUuid() + "|" + Date.now() + "|" + Math.random());
  const number = parseInt(digest.slice(0, 12), 16) % 1000000;
  return ("000000" + number).slice(-6);
}

function jsonpResponse_(callback, payload) {
  const safeCallback = /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback) ? callback : "";
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  if (!safeCallback) {
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(safeCallback + "(" + json + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function apiError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicErrorMessage_(error) {
  if (error && error.code) return error.message;
  return "Na serveru nastala chyba. Zkuste to prosím později.";
}

function asDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate_(value) {
  const date = asDate_(value);
  return date ? date.toISOString() : "";
}

function truncate_(value, maximum) {
  const text = String(value || "");
  return text.length > maximum ? text.slice(0, maximum - 1) + "…" : text;
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
