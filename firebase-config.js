export const firebaseConfig = {
  apiKey: "AIzaSyD-UCAyg9tPJGkU9GWED_P8Ur-kMhbBBh8",
  authDomain: "wheel-44c7f.firebaseapp.com",
  databaseURL: "https://wheel-44c7f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "wheel-44c7f",
  storageBucket: "wheel-44c7f.firebasestorage.app",
  messagingSenderId: "334213255427",
  appId: "1:334213255427:web:4d19324cb63f5c2bb29936"
};

export const APP_CHECK_SITE_KEY = "";
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.includes("PASTE_") && !firebaseConfig.databaseURL.includes("PASTE_");
}

export function isAppCheckConfigured() {
  return Boolean(APP_CHECK_SITE_KEY) && !APP_CHECK_SITE_KEY.includes("PASTE_");
}
