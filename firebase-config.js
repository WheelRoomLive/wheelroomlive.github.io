export const firebaseConfig = {
  apiKey: "PASTE_FIREBASE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://PASTE_PROJECT_ID-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

export const ADMIN_UID = "PASTE_ADMIN_FIREBASE_AUTH_UID_HERE";
export const APP_CHECK_SITE_KEY = "";
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.includes("PASTE_") && !firebaseConfig.databaseURL.includes("PASTE_");
}

export function isAdminConfigured() {
  return Boolean(ADMIN_UID) && !ADMIN_UID.includes("PASTE_");
}

export function isAppCheckConfigured() {
  return Boolean(APP_CHECK_SITE_KEY) && !APP_CHECK_SITE_KEY.includes("PASTE_");
}
