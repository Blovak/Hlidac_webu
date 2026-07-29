"use strict";

const APP_CONFIG = Object.freeze({
  apiUrl: "https://script.google.com/macros/s/AKfycbw8_ns2VSvPq_zNJXgfBdl-k3X-6EZIy0FuhB4EVpwyza1byyc8GzDnTEm4ZXuyH5By0A/exec",
  sessionKey: "hlidaniWebuSession",
  requestTimeoutMs: 20000,
});

const state = {
  email: "",
  token: "",
  urls: [],
  editingId: "",
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  restoreSession();
});

function cacheElements() {
  [
    "accountBar", "accountEmail", "logoutButton", "authView", "emailStep", "codeStep",
    "emailForm", "emailInput", "codeForm", "codeInput", "verificationEmail",
    "backToEmail", "resendCode", "authMessage", "dashboardView", "openAddForm",
    "emptyAddButton", "refreshButton", "loadingState", "emptyState", "urlList",
    "dashboardMessage", "activeCount", "changeCount", "nextCheck", "urlDialog",
    "urlForm", "urlId", "urlInput", "intervalValue", "intervalUnit", "activeInput",
    "dialogTitle", "dialogMessage", "saveUrlButton", "closeDialog", "cancelDialog",
    "urlCardTemplate",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.emailForm.addEventListener("submit", requestCode);
  elements.codeForm.addEventListener("submit", verifyCode);
  elements.backToEmail.addEventListener("click", showEmailStep);
  elements.resendCode.addEventListener("click", requestCode);
  elements.logoutButton.addEventListener("click", logout);
  elements.openAddForm.addEventListener("click", () => openUrlDialog());
  elements.emptyAddButton.addEventListener("click", () => openUrlDialog());
  elements.refreshButton.addEventListener("click", loadUrls);
  elements.urlForm.addEventListener("submit", saveUrl);
  elements.closeDialog.addEventListener("click", closeUrlDialog);
  elements.cancelDialog.addEventListener("click", closeUrlDialog);
  elements.urlDialog.addEventListener("click", (event) => {
    if (event.target === elements.urlDialog) closeUrlDialog();
  });
  elements.codeInput.addEventListener("input", () => {
    elements.codeInput.value = elements.codeInput.value.replace(/\D/g, "").slice(0, 6);
  });
}

async function restoreSession() {
  const stored = safeJsonParse(localStorage.getItem(APP_CONFIG.sessionKey));
  if (!stored?.email || !stored?.token) {
    showAuth();
    return;
  }

  state.email = stored.email;
  state.token = stored.token;
  showDashboard();
  await loadUrls();
}

async function requestCode(event) {
  event?.preventDefault();
  const email = (elements.emailInput.value || state.email).trim().toLowerCase();
  if (!isEmail(email)) {
    setMessage(elements.authMessage, "Zadejte platnou e-mailovou adresu.");
    return;
  }
  if (!apiIsConfigured()) return;

  state.email = email;
  setFormBusy(elements.emailForm, true);
  setMessage(elements.authMessage, "");

  try {
    await api("requestCode", { email });
    elements.verificationEmail.textContent = email;
    elements.emailStep.hidden = true;
    elements.codeStep.hidden = false;
    elements.codeInput.value = "";
    elements.codeInput.focus();
    setMessage(elements.authMessage, "Kód byl odeslán. Zkontrolujte i složku Spam.", true);
  } catch (error) {
    setMessage(elements.authMessage, error.message);
  } finally {
    setFormBusy(elements.emailForm, false);
  }
}

async function verifyCode(event) {
  event.preventDefault();
  const code = elements.codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    setMessage(elements.authMessage, "Kód musí mít přesně 6 číslic.");
    return;
  }

  setFormBusy(elements.codeForm, true);
  setMessage(elements.authMessage, "");
  try {
    const result = await api("verifyCode", { email: state.email, code });
    state.token = result.token;
    state.email = result.email;
    localStorage.setItem(APP_CONFIG.sessionKey, JSON.stringify({
      email: state.email,
      token: state.token,
    }));
    showDashboard();
    await loadUrls();
  } catch (error) {
    setMessage(elements.authMessage, error.message);
  } finally {
    setFormBusy(elements.codeForm, false);
  }
}

function showEmailStep() {
  elements.codeStep.hidden = true;
  elements.emailStep.hidden = false;
  elements.emailInput.value = state.email;
  setMessage(elements.authMessage, "");
  elements.emailInput.focus();
}

function showAuth(message = "") {
  elements.authView.hidden = false;
  elements.dashboardView.hidden = true;
  elements.accountBar.hidden = true;
  elements.emailStep.hidden = false;
  elements.codeStep.hidden = true;
  setMessage(elements.authMessage, message);
}

function showDashboard() {
  elements.authView.hidden = true;
  elements.dashboardView.hidden = false;
  elements.accountBar.hidden = false;
  elements.accountEmail.textContent = state.email;
}

async function logout() {
  try {
    if (state.token) await api("logout", { token: state.token });
  } catch {
    // The local session must still be removed when the backend cannot be reached.
  }
  clearSession();
  showAuth("Byli jste odhlášeni.");
}

function clearSession() {
  localStorage.removeItem(APP_CONFIG.sessionKey);
  state.email = "";
  state.token = "";
  state.urls = [];
}

async function loadUrls() {
  elements.loadingState.hidden = false;
  elements.emptyState.hidden = true;
  elements.urlList.replaceChildren();
  setMessage(elements.dashboardMessage, "");

  try {
    const result = await api("listUrls", { token: state.token });
    state.urls = Array.isArray(result.urls) ? result.urls : [];
    renderUrls();
  } catch (error) {
    if (error.code === "UNAUTHORIZED") {
      clearSession();
      showAuth("Platnost přihlášení vypršela. Nechte si poslat nový kód.");
      return;
    }
    setMessage(elements.dashboardMessage, error.message);
  } finally {
    elements.loadingState.hidden = true;
  }
}

function renderUrls() {
  elements.urlList.replaceChildren();
  elements.emptyState.hidden = state.urls.length !== 0;

  const activeUrls = state.urls.filter((item) => item.active);
  elements.activeCount.textContent = String(activeUrls.length);
  elements.changeCount.textContent = String(state.urls.filter((item) => item.lastChange).length);

  const nextDates = activeUrls
    .map((item) => parseDate(item.nextCheck))
    .filter(Boolean)
    .sort((a, b) => a - b);
  elements.nextCheck.textContent = nextDates.length ? formatDate(nextDates[0]) : "—";

  state.urls.forEach((item) => {
    const card = elements.urlCardTemplate.content.firstElementChild.cloneNode(true);
    if (!item.active) card.classList.add("inactive");
    if (item.lastError) card.classList.add("has-error");

    const link = card.querySelector(".url-link");
    link.href = item.url;
    link.textContent = item.url;
    link.title = item.url;

    card.querySelector(".status-badge").textContent = item.active ? "Aktivní" : "Pozastaveno";
    card.querySelector(".interval-label").textContent =
      `Kontrola: každé ${item.intervalValue} ${unitLabel(item.intervalUnit, item.intervalValue)}`;
    card.querySelector(".last-check-label").textContent =
      item.lastCheck ? `Naposledy: ${formatDate(parseDate(item.lastCheck))}` : "Čeká na první kontrolu";
    card.querySelector(".change-label").textContent =
      item.lastChange ? `Změna: ${formatDate(parseDate(item.lastChange))}` : "Změna zatím nezachycena";

    const errorElement = card.querySelector(".url-error");
    if (item.lastError) {
      errorElement.hidden = false;
      errorElement.textContent = `Poslední chyba: ${item.lastError}`;
    }

    card.querySelector(".edit-button").addEventListener("click", () => openUrlDialog(item));
    card.querySelector(".delete-button").addEventListener("click", () => deleteUrl(item));
    elements.urlList.append(card);
  });
}

function openUrlDialog(item = null) {
  state.editingId = item?.id || "";
  elements.urlId.value = state.editingId;
  elements.urlInput.value = item?.url || "";
  elements.intervalValue.value = item?.intervalValue || 1;
  elements.intervalUnit.value = item?.intervalUnit || "days";
  elements.activeInput.checked = item?.active ?? true;
  elements.dialogTitle.textContent = item ? "Upravit stránku" : "Přidat stránku";
  setMessage(elements.dialogMessage, "");
  elements.urlDialog.showModal();
  elements.urlInput.focus();
}

function closeUrlDialog() {
  elements.urlDialog.close();
  elements.urlForm.reset();
  state.editingId = "";
}

async function saveUrl(event) {
  event.preventDefault();
  const url = elements.urlInput.value.trim();
  const intervalValue = Number(elements.intervalValue.value);
  const intervalUnit = elements.intervalUnit.value;

  if (!isPublicHttpUrl(url)) {
    setMessage(elements.dialogMessage, "Zadejte veřejnou adresu začínající http:// nebo https://.");
    return;
  }
  if (!Number.isInteger(intervalValue) || intervalValue < 1 || intervalValue > 8760) {
    setMessage(elements.dialogMessage, "Interval musí být celé číslo od 1 do 8760.");
    return;
  }

  setFormBusy(elements.urlForm, true);
  setMessage(elements.dialogMessage, "");
  try {
    await api(state.editingId ? "updateUrl" : "addUrl", {
      token: state.token,
      id: state.editingId,
      url,
      intervalValue,
      intervalUnit,
      active: elements.activeInput.checked ? "true" : "false",
    });
    closeUrlDialog();
    await loadUrls();
  } catch (error) {
    setMessage(elements.dialogMessage, error.message);
  } finally {
    setFormBusy(elements.urlForm, false);
  }
}

async function deleteUrl(item) {
  if (!window.confirm(`Opravdu odstranit sledování stránky?\n\n${item.url}`)) return;
  setMessage(elements.dashboardMessage, "");
  try {
    await api("deleteUrl", { token: state.token, id: item.id });
    await loadUrls();
  } catch (error) {
    setMessage(elements.dashboardMessage, error.message);
  }
}

function api(action, parameters = {}) {
  return new Promise((resolve, reject) => {
    if (!apiIsConfigured()) {
      reject(new Error("Aplikace zatím nemá nastavenou adresu Google Apps Scriptu."));
      return;
    }

    const callbackName = `__hlidaniWebu_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Server neodpověděl včas. Zkuste to prosím znovu."));
    }, APP_CONFIG.requestTimeoutMs);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (response) => {
      cleanup();
      if (response?.ok) {
        resolve(response.data || {});
      } else {
        const error = new Error(response?.error?.message || "Požadavek se nezdařil.");
        error.code = response?.error?.code || "API_ERROR";
        reject(error);
      }
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Google Apps Script není dostupný nebo není nasazený pro veřejný přístup."));
    };

    const query = new URLSearchParams({
      action,
      callback: callbackName,
      ...Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)])),
    });
    script.src = `${APP_CONFIG.apiUrl}?${query.toString()}`;
    document.head.append(script);
  });
}

function apiIsConfigured() {
  const configured = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(APP_CONFIG.apiUrl);
  if (!configured) {
    setMessage(
      elements.authMessage,
      "Aplikaci je nejprve nutné propojit s nasazeným Google Apps Scriptem podle README."
    );
  }
  return configured;
}

function setFormBusy(form, busy) {
  form.querySelectorAll("button, input, select").forEach((control) => {
    control.disabled = busy;
  });
}

function setMessage(element, message, success = false) {
  element.textContent = message || "";
  element.classList.toggle("success", Boolean(message && success));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 100;
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function unitLabel(unit, value) {
  const labels = {
    hours: value === 1 ? "hodinu" : "hodin",
    days: value === 1 ? "den" : "dní",
    weeks: value === 1 ? "týden" : "týdnů",
  };
  return labels[unit] || unit;
}
