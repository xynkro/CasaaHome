import { initializeApp } from 'firebase/app'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth'
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

// Offline-first: the whole point of a pantry app is that it works while you
// are standing in a store cupboard with one bar of signal.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const auth = getAuth(app)
export const storage = getStorage(app)

export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

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
