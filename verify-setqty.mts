import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc } from 'firebase/firestore'
const app = initializeApp({ apiKey: 'AIzaSyDIX5btk3NO2ZeGV7U3MfIdl-xSMNUJPVU', projectId: 'casaahome', authDomain: 'casaahome.firebaseapp.com' })
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080)
const email = 'the.disruptive.comp@gmail.com'
await signInWithCredential(auth, GoogleAuthProvider.credential(
  JSON.stringify({ sub: email, email, email_verified: true, name: 'Caspar' })))

const ref = doc(db, 'items', 'i4')            // Sea salt, qty 6
const before = (await getDoc(ref)).data()!
console.log('before qty:', before.qty)

// EXACTLY what setQty builds when nobody typed a note.
const ev = {
  id: 'test-event', itemId: 'i4', type: 'reconcile',
  qtyBefore: before.qty, qtyAfter: 2, delta: 2 - before.qty,
  at: new Date().toISOString(), by: email,
  note: undefined,
}
try {
  await updateDoc(ref, { qty: 2, history: [ev], burnPerDay: null,
                         lastVerifiedAt: ev.at, updatedAt: ev.at })
  console.log('WRITE SUCCEEDED')
} catch (e) {
  console.log('WRITE REJECTED:', (e as Error).message.slice(0, 150))
}
const after = (await getDoc(ref)).data()!
console.log('after qty :', after.qty, after.qty === before.qty ? '  <-- THE CORRECTION DID NOT SAVE' : '  (saved)')
process.exit(0)
