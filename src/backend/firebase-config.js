/**
 * firebase-config.js — Firebase v10 (modular) initialisation for DEAD ZONE
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  STEP-BY-STEP FIREBASE SETUP (free Spark tier — NO credit card required)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  1. CREATE PROJECT
 *     → https://console.firebase.google.com
 *     → "Add project" → name it "dead-zone" → Disable Analytics (optional)
 *
 *  2. REGISTER WEB APP
 *     → Project Overview → </> (Web icon) → App nickname "dead-zone-web"
 *     → Copy the firebaseConfig object → paste it into FIREBASE_CONFIG below
 *
 *  3. AUTHENTICATION
 *     → Build → Authentication → Get started
 *     → Sign-in method → Enable "Anonymous"
 *     → Sign-in method → Enable "Google" (add a support email)
 *
 *  4. FIRESTORE DATABASE
 *     → Build → Firestore Database → Create database
 *     → Start in TEST MODE → choose nearest region → Done
 *     → Replace rules (Rules tab) with the snippet in FIRESTORE_RULES below
 *
 *  5. STORAGE
 *     → Build → Storage → Get started → Test mode
 *     → Replace rules with the snippet in STORAGE_RULES below
 *
 *  6. INSTALL SDK  (run in your terminal)
 *     npm install firebase
 *
 *  7. DEPLOY  (optional, for production)
 *     npm install -g firebase-tools
 *     firebase login
 *     firebase init hosting   → dist/ as public, single-page app: yes
 *     npm run build && firebase deploy
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FIRESTORE RULES  (Console → Firestore → Rules → Publish)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  rules_version = '2';
 *  service cloud.firestore {
 *    match /databases/{database}/documents {
 *      match /users/{userId} {
 *        allow read, write: if request.auth != null && request.auth.uid == userId;
 *      }
 *      match /leaderboard/{entryId} {
 *        allow read: if request.auth != null;
 *        allow write: if request.auth != null
 *                     && request.resource.data.uid == request.auth.uid
 *                     && request.resource.data.score is number;
 *      }
 *      match /leaderboard_weekly/{entryId} {
 *        allow read: if request.auth != null;
 *        allow write: if request.auth != null
 *                     && request.resource.data.uid == request.auth.uid;
 *      }
 *    }
 *  }
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *  STORAGE RULES  (Console → Storage → Rules → Publish)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  rules_version = '2';
 *  service firebase.storage {
 *    match /b/{bucket}/o {
 *      match /screenshots/{userId}/{file} {
 *        allow read: if true;
 *        allow write: if request.auth != null
 *                     && request.auth.uid == userId
 *                     && request.resource.size < 2 * 1024 * 1024
 *                     && request.resource.contentType.matches('image/.*');
 *      }
 *    }
 *  }
 */

// ─── Config — env vars (Vercel/local) take priority, then inline fallbacks ─────
// In local dev: copy .env.example → .env.local and fill values.
// In Vercel: Project → Settings → Environment Variables.
const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'AIzaSyAYBCD5dLcsn5ihM7GmNVHvKws9NevF5eo',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'deadzoneg-8710a.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'deadzoneg-8710a',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'deadzoneg-8710a.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '858602412289',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? '1:858602412289:web:a09e21f1b1bf5c8a7ca300',
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID      ?? 'G-3ZRJDG58VM',
};

// ─── Runtime flag — false until config is filled in ───────────────────────────
export const FIREBASE_ENABLED = !FIREBASE_CONFIG.apiKey.startsWith('YOUR_');

// ─── Mutable singleton refs (live ES-module bindings — importers see updates) ──
export let app     = null;
export let auth    = null;
export let db      = null;
export let storage = null;

let _initPromise = null;

export async function initFirebase() {
  if (!FIREBASE_ENABLED) return false;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const [
        { initializeApp },
        { getAuth },
        { getFirestore, enableIndexedDbPersistence },
        { getStorage: _getStorage },
      ] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
        import('firebase/storage'),
      ]);

      app     = initializeApp(FIREBASE_CONFIG);
      auth    = getAuth(app);
      db      = getFirestore(app);
      storage = _getStorage(app);

      // Offline persistence — silently ignore if already enabled or unsupported
      enableIndexedDbPersistence(db).catch(() => {});

      console.info('[Firebase] connected →', FIREBASE_CONFIG.projectId);
      return true;
    } catch (e) {
      console.warn('[Firebase] init failed — offline mode active:', e.message);
      _initPromise = null;
      return false;
    }
  })();

  return _initPromise;
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────
export function currentUser() {
  return auth?.currentUser ?? null;
}

export async function signInAnon() {
  if (!auth) return null;
  try {
    const { signInAnonymously } = await import('firebase/auth');
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    console.warn('[Firebase] anon sign-in failed:', e.message);
    return null;
  }
}

export async function signInGoogle() {
  if (!auth) return null;
  try {
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    return cred.user;
  } catch (e) {
    console.warn('[Firebase] Google sign-in failed:', e.message);
    return null;
  }
}

export function onUserChange(cb) {
  if (!auth) return () => {};
  let unsub = () => {};
  import('firebase/auth').then(({ onAuthStateChanged }) => {
    unsub = onAuthStateChanged(auth, cb);
  });
  return () => unsub();
}

export async function signOutUser() {
  if (!auth) return;
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
}

// ─── Firestore convenience wrappers ───────────────────────────────────────────
export async function fsGet(path) {
  if (!db) return null;
  const { doc, getDoc } = await import('firebase/firestore');
  const snap = await getDoc(doc(db, ...path.split('/')));
  return snap.exists() ? snap.data() : null;
}

export async function fsSet(path, data, merge = true) {
  if (!db) return;
  const { doc, setDoc } = await import('firebase/firestore');
  await setDoc(doc(db, ...path.split('/')), data, { merge });
}

export async function fsQuery(collection, constraints = []) {
  if (!db) return [];
  const { collection: col, query, getDocs } = await import('firebase/firestore');
  const q   = query(col(db, collection), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
