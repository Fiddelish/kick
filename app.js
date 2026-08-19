"use strict";

const STORAGE_KEYS = {
  kickbot: "sc1simon-kickbot-widget-url",
  streamlabs: "sc1simon-streamlabs-alertbox-url-v2",
};

const startGate = document.querySelector("#start-gate");
const startForm = document.querySelector("#start-form");
const kickbotInput = document.querySelector("#kickbot-url");
const streamlabsInput = document.querySelector("#streamlabs-url");
const formError = document.querySelector("#form-error");
const kickbotFrame = document.querySelector("#kickbot-frame");
const streamlabsFrame = document.querySelector("#streamlabs-frame");
const connectionDot = document.querySelector("#connection-dot");
const connectionStatus = document.querySelector("#connection-status");
const settingsButton = document.querySelector("#open-settings");

kickbotInput.value = localStorage.getItem(STORAGE_KEYS.kickbot) || "";
streamlabsInput.value = localStorage.getItem(STORAGE_KEYS.streamlabs) || "";

function extractUrl(value) {
  const trimmed = value.trim();
  const markdownLink = trimmed.match(/\((https:\/\/[^)]+)\)$/i);
  return markdownLink ? markdownLink[1] : trimmed;
}

function isKickbotUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "widgets.kickbot.com" &&
      url.pathname.startsWith("/external/tipping/");
  } catch {
    return false;
  }
}

function isStreamlabsAlertBoxUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "streamlabs.com" || url.hostname === "www.streamlabs.com") &&
      url.pathname.startsWith("/alert-box/v3/") &&
      url.pathname.length > "/alert-box/v3/".length;
  } catch {
    return false;
  }
}

function setConnection(state, text) {
  connectionDot.className = `connection-dot ${state}`.trim();
  connectionStatus.textContent = text;
}

function startWidgets(kickbotUrl, streamlabsUrl) {
  setConnection("", "Streamlabs laddar");
  kickbotFrame.src = kickbotUrl;
  streamlabsFrame.src = streamlabsUrl;
  startGate.hidden = true;
}

streamlabsFrame.addEventListener("load", () => {
  if (streamlabsFrame.src !== "about:blank") {
    setConnection("connected", "Streamlabs live");
  }
});

streamlabsFrame.addEventListener("error", () => {
  setConnection("error", "Streamlabs fel");
});

startForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const kickbotUrl = extractUrl(kickbotInput.value);
  const streamlabsUrl = extractUrl(streamlabsInput.value);

  if (!isKickbotUrl(kickbotUrl)) {
    formError.textContent = "Kickbot-adressen är inte en giltig tipping-widget.";
    kickbotInput.focus();
    return;
  }

  if (!isStreamlabsAlertBoxUrl(streamlabsUrl)) {
    formError.textContent = "Använd Streamlabs-länken som börjar med https://streamlabs.com/alert-box/v3/";
    streamlabsInput.focus();
    return;
  }

  localStorage.setItem(STORAGE_KEYS.kickbot, kickbotUrl);
  localStorage.setItem(STORAGE_KEYS.streamlabs, streamlabsUrl);
  kickbotInput.value = kickbotUrl;
  streamlabsInput.value = streamlabsUrl;
  formError.textContent = "";
  startWidgets(kickbotUrl, streamlabsUrl);
});

settingsButton.addEventListener("click", () => {
  startGate.hidden = false;
});
