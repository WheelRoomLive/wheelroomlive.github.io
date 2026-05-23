import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  update
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import {
  APP_CHECK_SITE_KEY,
  firebaseConfig,
  isAppCheckConfigured,
  isFirebaseConfigured,
  ROOM_TTL_MS
} from "./firebase-config.js";

export const DEFAULT_ITEMS = ["100 points", "200 points", "Lose turn", "Spin again", "500 points", "Bankrupt"];
export const COLORS = ["#f05d5e", "#f2b84b", "#22a6a1", "#6f62d7", "#4aaf73", "#ea7a3d", "#315f9f", "#d9528c"];
export const ROOM_META = {
  pending: "xo",
  note: "xs"
};
export const firebaseReady = isFirebaseConfigured();
export const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const appCheck = firebaseReady && isAppCheckConfigured()
  ? initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  })
  : null;
export const db = firebaseReady ? getDatabase(app) : null;
export const auth = firebaseReady ? getAuth(app) : null;

export { onValue, ref, remove, runTransaction, set, update };

export function roomRef(roomId) {
  return ref(db, `rooms/${roomId}`);
}

export function newId() {
  return crypto.randomUUID();
}

export function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));

  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function getRoomJoinId(room) {
  return room?.ak ? `${room.id}_${room.ak}` : room?.id || "";
}

export function parseRoomJoinId(value) {
  const clean = String(value || "").trim();
  const separator = clean.lastIndexOf("_");

  if (separator <= 0 || separator >= clean.length - 1) {
    return null;
  }

  return {
    roomId: clean.slice(0, separator),
    accessKey: clean.slice(separator + 1)
  };
}

export async function ensureAnonymousAuth() {
  if (!firebaseReady) {
    throw new Error("Firebase is not configured.");
  }

  if (auth.currentUser?.isAnonymous) {
    return auth.currentUser;
  }

  if (auth.currentUser) {
    await signOut(auth);
  }

  const credential = await signInAnonymously(auth);

  return credential.user;
}

export function signOutAuth() {
  return auth ? signOut(auth) : Promise.resolve();
}

export function onAuthReady(callback) {
  if (!auth) {
    callback(null);
    return () => null;
  }

  return onAuthStateChanged(auth, callback);
}

export function cleanName(value, fallback = "Player") {
  return String(value || "").trim().slice(0, 24) || fallback;
}

export function now() {
  return Date.now();
}

export function expiryFrom(room) {
  return Number(room?.lastActiveAt || 0) + ROOM_TTL_MS;
}

export function isExpired(room) {
  return now() > expiryFrom(room);
}

export function isActiveSpin(room) {
  return Boolean(room?.spin && now() < room.spin.endsAt);
}

export function normalizeItems(value) {
  const rawItems = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  const uniqueItems = [];

  for (const item of rawItems) {
    const clean = String(item).trim().slice(0, 42);

    if (clean && !uniqueItems.includes(clean)) {
      uniqueItems.push(clean);
    }
  }

  return uniqueItems.slice(0, 16);
}

export function objectValues(value) {
  return Object.values(value || {});
}

export function playersList(room) {
  return objectValues(room?.players).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

export function findPlayer(room, playerId) {
  return playersList(room).find(player => player.id === playerId) || null;
}

export function chatList(room) {
  return objectValues(room?.chatMessages).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function visibleSpinHistory(room) {
  const timestamp = now();
  return objectValues(room?.spinHistory)
    .filter(entry => entry.endsAt <= timestamp)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function trimSpinHistory(historyMap) {
  const entries = objectValues(historyMap).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 25);
  return Object.fromEntries(entries.map(entry => [entry.id, entry]));
}

export function makeRoom(host) {
  const timestamp = now();

  return {
    id: newId(),
    ak: newSecret(),
    createdAt: timestamp,
    lastActiveAt: timestamp,
    released: false,
    items: DEFAULT_ITEMS,
    spin: null,
    [ROOM_META.pending]: null,
    [ROOM_META.note]: {
      state: "idle",
      text: "No target set.",
      item: null,
      updatedAt: timestamp
    },
    players: {
      host
    },
    chatMessages: {},
    spinHistory: {}
  };
}

export function validNextSpinOverride(room) {
  const override = room?.[ROOM_META.pending];

  if (!override) {
    return null;
  }

  if (!Number.isInteger(override.winnerIndex) || override.winnerIndex < 0 || override.winnerIndex >= room.items.length) {
    return null;
  }

  if (!Number.isFinite(Number(override.landingBias))) {
    return null;
  }

  return {
    winnerIndex: override.winnerIndex,
    landingBias: Number(override.landingBias)
  };
}

export function makeSpin(room, actor) {
  const timestamp = now();
  const forcedSpin = validNextSpinOverride(room);
  const winnerIndex = forcedSpin?.winnerIndex ?? Math.floor(Math.random() * room.items.length);
  const duration = 20000 + Math.floor(Math.random() * 6001);
  const fullTurns = Math.floor(duration / 440) + Math.floor(Math.random() * 12);
  const segmentDeg = 360 / room.items.length;
  const landingBias = forcedSpin?.landingBias ?? (0.16 + Math.random() * 0.68);
  const targetAngle = winnerIndex * segmentDeg + segmentDeg * landingBias;
  const baseRotation = Number.isFinite(Number(room?.spin?.finalRotation)) ? Number(room.spin.finalRotation) : 0;
  const targetRotation = positiveModulo(360 - targetAngle, 360);
  const extraRotation = fullTurns * 360 + positiveModulo(targetRotation - positiveModulo(baseRotation, 360), 360);
  const finalRotation = baseRotation + extraRotation;
  const id = newId();

  return {
    spin: {
      id,
      winnerIndex,
      targetAngle,
      finalRotation,
      startedAt: timestamp,
      endsAt: timestamp + duration,
      duration,
      by: actor.name,
      byRole: actor.role
    },
    historyEntry: {
      id,
      by: actor.name,
      byRole: actor.role,
      item: room.items[winnerIndex],
      winnerIndex,
      startedAt: timestamp,
      endsAt: timestamp + duration,
      duration,
      forced: Boolean(forcedSpin)
    },
    forcedSpin
  };
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export async function settleFinishedTarget(room) {
  const status = room?.[ROOM_META.note];

  if (!room?.id || status?.state !== "spinning") {
    return;
  }

  if (now() < status.spinEndsAt) {
    return;
  }

  await update(ref(db, `rooms/${room.id}/${ROOM_META.note}`), {
    state: "cleared",
    text: `Target spin finished and cleared: ${status.item}.`,
    item: status.item || null,
    clearedAt: now(),
    updatedAt: now()
  });
}

export async function removeExpiredRooms(roomsMap) {
  const removals = objectValues(roomsMap)
    .filter(room => room?.id && isExpired(room))
    .map(room => remove(ref(db, `rooms/${room.id}`)).catch(() => null));

  await Promise.all(removals);
}

export async function encryptChatText(roomId, text) {
  const key = await getRoomChatKey(roomId, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptChatText(roomId, message) {
  const key = await getRoomChatKey(roomId, ["decrypt"]);
  const iv = base64ToBytes(message.iv);
  const ciphertext = base64ToBytes(message.ciphertext);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

  return new TextDecoder().decode(decrypted);
}

async function getRoomChatKey(roomId, usages) {
  const source = new TextEncoder().encode(`wheel-room-chat:${roomId}`);
  const digest = await crypto.subtle.digest("SHA-256", source);

  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, usages);
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

export function formatTime(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
