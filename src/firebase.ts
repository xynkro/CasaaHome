import { initializeApp } from 'firebase/app'
import {
  initializeFirestore, memoryLocalCache, persistentLocalCache,
  persistentMultipleTabManager, connectFirestoreEmulator, type Firestore,
} from 'firebase/firestore'
import {
  getAuth, initializeAuth, GoogleAuthProvider, connectAuthEmulator,
  indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  inMemoryPersistence, browserPopupRedirectResolver, type Auth,
} from 'firebase/auth'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

// This config is public by design (Firebase web keys are identifiers, not
// secrets). Access control lives in firestore.rules / storage.rules, which
// gate everything on the allowlist in config/access.
const firebaseConfig = {
  apiKey: 'AIzaSyDIX5btk3NO2ZeGV7U3MfIdl-xSMNUJPVU',
  authDomain: 'casaahome.firebaseapp.com',
  projectId: 'casaahome',
  storageBucket: 'casaahome.firebasestorage.app',
  messagingSenderId: '311671403774',
  appId: '1:311671403774:web:5372e39c28ff4f3832a1af',
}

export const app = initializeApp(firebaseConfig)

/**
 * Auth with an explicit persistence ladder.
 *
 * The default is IndexedDB only, and IndexedDB is genuinely unavailable in
 * several ordinary situations — private windows, in-app browsers (Telegram,
 * Instagram, some webviews), and browsers with site storage blocked. When it
 * fails the SDK throws out of signInWithPopup with a raw storage error
 * ("Database is closing/hidden"), which reads to the user as though the app's
 * database is broken. Listing fallbacks lets it degrade to a session-scoped
 * or in-memory login instead of refusing to sign in at all.
 */
function makeAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
      // Required explicitly with initializeAuth, or popup and redirect
      // sign-in are both unavailable.
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  } catch {
    // Already initialised (hot reload), or the environment rejected the
    // whole ladder. getAuth returns the existing instance.
    return getAuth(app)
  }
}

export const auth = makeAuth()

/**
 * Offline-first: the point of a pantry app is that it works while you are
 * standing in a store cupboard with one bar of signal. But the persistent
 * cache is also IndexedDB — where that is blocked, fall back to memory so the
 * app still runs, just without offline reads.
 */
function makeDb(): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch {
    return initializeFirestore(app, { localCache: memoryLocalCache() })
  }
}

export const db = makeDb()
export const storage = getStorage(app)

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

/** True when the browser will not give us a working IndexedDB. */
export async function indexedDbUsable(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false
  try {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('casaahome-probe')
      req.onsuccess = () => { req.result.close(); resolve() }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('blocked'))
    })
    indexedDB.deleteDatabase('casaahome-probe')
    return true
  } catch {
    return false
  }
}

// Local development against `firebase emulators:start`. Never true in a
// production build — Vite strips this branch entirely.
if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)

  // Sign in without the OAuth popup. The Auth emulator accepts an unsigned
  // claims blob in place of a real Google ID token.
  ;(globalThis as unknown as Record<string, unknown>).__emuSignIn = async (email: string) => {
    const { signInWithCredential } = await import('firebase/auth')
    return signInWithCredential(
      auth,
      GoogleAuthProvider.credential(
        JSON.stringify({ sub: email, email, email_verified: true, name: email.split('@')[0] }),
      ),
    )
  }
}
