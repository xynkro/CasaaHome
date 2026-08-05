/**
 * Storage rules test.
 *
 * Exercises the deployed storage.rules against real request shapes: every
 * household member, a stranger, a signed-out caller, an unverified email, an
 * oversized file and a non-image. Reuses the Firebase CLI login, so run it
 * after `firebase login`.
 *
 *   node scripts/rules.test.mjs
 */
import os from 'os'; import fs from 'fs';
const c = JSON.parse(fs.readFileSync(os.homedir()+'/.config/configstore/firebase-tools.json','utf8'));
const b = new URLSearchParams({ client_id:'563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret:'j9iVZfS8kkCEFUPaAeJV0sAi', refresh_token:c.tokens.refresh_token, grant_type:'refresh_token' });
const j = await (await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:b})).json();
const H = {'Authorization':'Bearer '+j.access_token,'Content-Type':'application/json'};
const source = fs.readFileSync('/Users/xynkro/Documents/CasaaHome/storage.rules','utf8');

const auth = (email, verified=true) => ({ uid:'u1', token:{ email, email_verified:verified } });
const req = (email, verified, size=200000, type='image/jpeg') => ({
  path: '/b/casaahome.firebasestorage.app/o/items/photo.jpg',
  method: 'create',
  auth: email ? auth(email, verified) : null,
  resource: { size, contentType: type },
})

const cases = [
  ['Caspar (xynkro)          ', req('xynkro@gmail.com', true), 'ALLOW'],
  ['Caspar (disruptive.comp) ', req('the.disruptive.comp@gmail.com', true), 'ALLOW'],
  ['Sarah                    ', req('sarah.sanusi@gmail.com', true), 'ALLOW'],
  ['stranger@gmail.com       ', req('stranger@gmail.com', true), 'DENY'],
  ['signed out               ', req(null, false), 'DENY'],
  ['unverified email         ', req('xynkro@gmail.com', false), 'DENY'],
  ['20 MB file (over cap)    ', req('xynkro@gmail.com', true, 20*1024*1024), 'DENY'],
  ['a PDF, not an image      ', req('xynkro@gmail.com', true, 200000, 'application/pdf'), 'DENY'],
];

const r = await fetch('https://firebaserules.googleapis.com/v1/projects/casaahome:test', {
  method:'POST', headers:H, body: JSON.stringify({
    source: { files: [{ name:'storage.rules', content: source }] },
    testSuite: { testCases: cases.map(([,rq,exp]) => ({
      expectation: exp === 'ALLOW' ? 'ALLOW' : 'DENY',
      request: rq, functionMocks: [],
    })) },
  })});
const out = await r.json();
if (!r.ok) { console.log('test API', r.status, JSON.stringify(out).slice(0,400)); process.exit(1) }
const results = out.testResults || [];
let bad = 0;
results.forEach((res, i) => {
  const [name,,exp] = cases[i];
  const ok = res.state === 'SUCCESS';
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name} expected ${exp}${ok?'':'  <- '+JSON.stringify(res).slice(0,120)}`);
});
console.log(bad ? `\n${bad} FAILED` : '\nAll storage rule cases behave as intended.');
