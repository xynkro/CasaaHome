import { initializeApp } from 'firebase/app'
import { initializeFirestore, doc, updateDoc, memoryLocalCache } from 'firebase/firestore'
const app = initializeApp({ projectId: 'demo-x', apiKey: 'k', appId: '1' })
const db = initializeFirestore(app, { localCache: memoryLocalCache() })
const ev = { id: 'e1', itemId: 'zz', type: 'reconcile', qtyBefore: 2, qtyAfter: 3, delta: 1, at: '2026-08-07', by: 'me', note: '' }
try {
  updateDoc(doc(db, 'items', 'zz'), { qty: 3, history: [ev], burnPerDay: null, lastVerifiedAt: 'x', updatedAt: 'x' })
  console.log('NO THROW')
} catch (e) { console.log('THREW:', e.message) }
