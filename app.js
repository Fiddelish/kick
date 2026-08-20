"use strict";

const STORAGE_KEYS = {
  kickbot: "sc1simon-kickbot-widget-url",
  streamlabs: "sc1simon-streamlabs-socket-url-v3",
};

const DEFAULT_SOUND = "https://streamlabs.com/sounds/gallery/default.ogg";
const KICKS_SOUND = "https://cdn.twitchalerts.com/twitch-bits/sounds/bits.ogg";

const TYPE_INFO = {
  donation: { label: "Donation", icon: "💚", verb: "skickade", spokenVerb: "sent" },
  follow: { label: "Ny följare", icon: "+1", verb: "följer nu", spokenVerb: "is now following" },
  subscription: { label: "Prenumeration", icon: "★", verb: "prenumererar nu", spokenVerb: "just subscribed" },
  resub: { label: "Förnyad prenumeration", icon: "★", verb: "prenumererar igen", spokenVerb: "subscribed again" },
  sub: { label: "Prenumeration", icon: "★", verb: "prenumererar nu", spokenVerb: "just subscribed" },
  kicks: { label: "Kicks", icon: "K", verb: "skickade", spokenVerb: "sent" },
  raid: { label: "Raid", icon: "⚡", verb: "raidar med", spokenVerb: "is raiding with" },
  host: { label: "Host", icon: "⚡", verb: "hostar", spokenVerb: "is hosting" },
  merch: { label: "Merch", icon: "◆", verb: "köpte merch", spokenVerb: "bought merchandise" },
};

const alertBox = document.querySelector("#streamlabs-alert");
const alertMedia = document.querySelector("#alert-media");
const alertType = document.querySelector("#alert-type");
const alertTitle = document.querySelector("#alert-title");
const alertMessage = document.querySelector("#alert-message");
const connectionDot = document.querySelector("#connection-dot");
const connectionStatus = document.querySelector("#connection-status");
const startGate = document.querySelector("#start-gate");
const startForm = document.querySelector("#start-form");
const kickbotInput = document.querySelector("#kickbot-url");
const streamlabsInput = document.querySelector("#streamlabs-url");
const formError = document.querySelector("#form-error");
const kickbotFrame = document.querySelector("#kickbot-frame");
const kickbotUnlockHint = document.querySelector("#kickbot-unlock-hint");
const testButton = document.querySelector("#test-alert");
const settingsButton = document.querySelector("#open-settings");

const queue = [];
const seenAlerts = new Map();
const DEDUPE_WINDOW_MS = 30000;
const MAX_QUEUE_LENGTH = 6;
let showingAlert = false;
let audioEnabled = false;
let socket = null;
let acceptStreamlabsAlertsAfter = 0;

kickbotInput.value = localStorage.getItem(STORAGE_KEYS.kickbot) || "";
streamlabsInput.value = localStorage.getItem(STORAGE_KEYS.streamlabs) || "";

kickbotFrame.addEventListener("load", () => {
  if (kickbotFrame.src === "about:blank") return;
  kickbotUnlockHint.classList.remove("active");
  void kickbotUnlockHint.offsetWidth;
  kickbotUnlockHint.classList.add("active");
});

function extractUrl(value) {
  const trimmed = value.trim();
  const markdownLink = trimmed.match(/\((https:\/\/[^)]+)\)$/i);
  return markdownLink ? markdownLink[1] : trimmed;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  const element = document.createElement("div");
  element.innerHTML = String(value);
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function firstValue(item, keys) {
  for (const key of keys) {
    const value = item && item[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return "";
}

function normalizeAlert(packet, item) {
  const type = String(packet.type || item.type || "alert").toLowerCase();
  const info = TYPE_INFO[type] || {
    label: "Ny alert",
    icon: "!",
    verb: "skickade en alert",
    spokenVerb: "sent an alert",
  };
  const name = clean(firstValue(item, [
    "display_name", "from_display_name", "name", "from", "username", "sender",
  ])) || "Someone";
  const amount = clean(firstValue(item, [
    "formatted_amount", "formattedAmount", "displayString", "amount", "months", "viewers",
  ]));
  const message = clean(firstValue(item, [
    "message", "user_message", "userMessage", "text", "comment",
  ]));
  const title = amount ? `${name} ${info.verb} ${amount}` : `${name} ${info.verb}`;
  const spokenTitle = amount
    ? `${name} ${info.spokenVerb} ${amount}`
    : `${name} ${info.spokenVerb}`;
  const image = clean(firstValue(item, ["image", "image_url", "imageUrl", "avatar", "gif"]));

  return {
    label: info.label,
    icon: info.icon,
    title,
    message,
    image,
    sound: type === "kicks" ? KICKS_SOUND : DEFAULT_SOUND,
    spoken: [spokenTitle, message].filter(Boolean).join(". "),
  };
}

function alertFingerprint(type, item) {
  const id = clean(firstValue(item, [
    "id", "event_id", "eventId", "message_id", "messageId", "donation_id", "transaction_id",
  ]));
  if (id) return `${type}:id:${id}`;

  return `${type}:data:${JSON.stringify({
    name: firstValue(item, ["display_name", "from_display_name", "name", "from", "username", "sender"]),
    amount: firstValue(item, ["formatted_amount", "formattedAmount", "displayString", "amount", "months", "viewers"]),
    message: firstValue(item, ["message", "user_message", "userMessage", "text", "comment"]),
    time: firstValue(item, ["created_at", "createdAt", "timestamp", "date"]),
  })}`;
}

function isDuplicateAlert(fingerprint) {
  const now = Date.now();
  for (const [key, seenAt] of seenAlerts) {
    if (now - seenAt > DEDUPE_WINDOW_MS) seenAlerts.delete(key);
  }

  const previous = seenAlerts.get(fingerprint);
  if (previous && now - previous <= DEDUPE_WINDOW_MS) return true;
  seenAlerts.set(fingerprint, now);
  return false;
}

function isStaleAlert(item) {
  const value = firstValue(item, ["created_at", "createdAt", "timestamp", "date"]);
  if (!value) return false;
  const timestamp = typeof value === "number"
    ? (value < 1000000000000 ? value * 1000 : value)
    : Date.parse(String(value));
  return Number.isFinite(timestamp) && Date.now() - timestamp > 120000;
}

function enqueuePacket(packet) {
  if (!packet || typeof packet !== "object" || Date.now() < acceptStreamlabsAlertsAfter) return;
  const receivedItems = Array.isArray(packet.message)
    ? packet.message
    : [packet.message || packet.data || packet];
  const items = receivedItems.slice(-1);

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const type = String(packet.type || item.type || "").toLowerCase();
    if (!Object.hasOwn(TYPE_INFO, type) || isStaleAlert(item)) continue;
    const fingerprint = alertFingerprint(type, item);
    if (isDuplicateAlert(fingerprint)) continue;
    if (queue.length < MAX_QUEUE_LENGTH) queue.push(normalizeAlert(packet, item));
  }
  showNextAlert();
}

function renderMedia(alert) {
  alertMedia.replaceChildren();
  if (!alert.image) {
    alertMedia.textContent = alert.icon;
    return;
  }

  const isVideo = /\.(webm|mp4)(?:[?#]|$)/i.test(alert.image);
  const media = document.createElement(isVideo ? "video" : "img");
  media.src = alert.image;
  if (isVideo) {
    media.autoplay = true;
    media.loop = true;
    media.muted = true;
    media.playsInline = true;
  }
  media.addEventListener("error", () => {
    alertMedia.replaceChildren();
    alertMedia.textContent = alert.icon;
  }, { once: true });
  alertMedia.append(media);
}

function playSound(url) {
  if (!audioEnabled || !url) return;
  const audio = new Audio(url);
  audio.volume = 0.65;
  audio.play().catch(() => {});
}

function speak(text) {
  if (!audioEnabled || !text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) || null;
  utterance.lang = utterance.voice ? utterance.voice.lang : "en-US";
  utterance.volume = 1;
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function showNextAlert() {
  if (showingAlert || queue.length === 0) return;
  showingAlert = true;
  const alert = queue.shift();

  alertType.textContent = alert.label;
  alertTitle.textContent = alert.title;
  alertMessage.textContent = alert.message;
  alertMessage.hidden = !alert.message;
  renderMedia(alert);
  alertBox.hidden = false;
  alertBox.className = "streamlabs-alert entering";
  playSound(alert.sound);
  speak(alert.spoken);

  window.setTimeout(() => { alertBox.className = "streamlabs-alert leaving"; }, 5500);
  window.setTimeout(() => {
    alertBox.hidden = true;
    alertBox.className = "streamlabs-alert";
    showingAlert = false;
    showNextAlert();
  }, 6100);
}

function setConnection(state, text) {
  connectionDot.className = `connection-dot ${state}`.trim();
  connectionStatus.textContent = text;
}

function connectStreamlabs(url) {
  if (socket) socket.disconnect();
  socket = null;

  if (typeof window.io !== "function") {
    setConnection("error", "Anslutning saknas");
    return;
  }

  setConnection("", "Streamlabs ansluter");
  socket = window.io(url, {
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    timeout: 10000,
    transports: ["websocket", "polling"],
  });
  socket.on("connect", () => {
    acceptStreamlabsAlertsAfter = Date.now() + 1500;
    setConnection("connected", "Streamlabs live");
  });
  socket.on("event", enqueuePacket);
  socket.on("disconnect", () => setConnection("", "Återansluter"));
  socket.on("connect_error", () => setConnection("error", "Anslutningsfel"));
  socket.on("error", () => setConnection("error", "Anslutningsfel"));
}

function isKickbotUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "widgets.kickbot.com" &&
      parsed.pathname.startsWith("/external/tipping/");
  } catch {
    return false;
  }
}

function isStreamlabsSocketUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "aws-io.streamlabs.com" &&
      parsed.searchParams.has("token");
  } catch {
    return false;
  }
}

function unlockAudio() {
  audioEnabled = true;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    const warmup = new SpeechSynthesisUtterance(" ");
    warmup.lang = "en-US";
    warmup.volume = 0;
    window.speechSynthesis.speak(warmup);
  }
}

startForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const kickbotUrl = extractUrl(kickbotInput.value);
  const streamlabsUrl = extractUrl(streamlabsInput.value);

  if (!isKickbotUrl(kickbotUrl)) {
    formError.textContent = "Kickbot-adressen är inte en giltig tipping-widget.";
    kickbotInput.focus();
    return;
  }

  if (!isStreamlabsSocketUrl(streamlabsUrl)) {
    formError.textContent = "Använd Streamlabs anslutningsadressen som börjar med https://aws-io.streamlabs.com?token=";
    streamlabsInput.focus();
    return;
  }

  localStorage.setItem(STORAGE_KEYS.kickbot, kickbotUrl);
  localStorage.setItem(STORAGE_KEYS.streamlabs, streamlabsUrl);
  kickbotInput.value = kickbotUrl;
  streamlabsInput.value = streamlabsUrl;
  formError.textContent = "";
  unlockAudio();
  kickbotFrame.src = kickbotUrl;
  connectStreamlabs(streamlabsUrl);
  startGate.hidden = true;
});

settingsButton.addEventListener("click", () => {
  startGate.hidden = false;
});

testButton.addEventListener("click", () => {
  unlockAudio();
  queue.push({
    label: "Testalert",
    icon: "K",
    title: "SC1Simon skickade 100 Kicks",
    message: "Animation, ljud och engelsk TTS fungerar.",
    image: "",
    sound: KICKS_SOUND,
    spoken: "Test alert. SC1Simon sent one hundred Kicks. Animation, sound, and text to speech are working.",
  });
  showNextAlert();
});
