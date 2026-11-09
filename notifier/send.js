// Run by GitHub Actions every few minutes: reads Firestore, sends due push notifications.
const admin = require('firebase-admin');
const webpush = require('web-push');
const { plan } = require('./logic');

const VAPID_PUBLIC_KEY = 'BGEIwj4d_9KvSzDtatbmsemSyVlBgtjt1uNCmBtk5_KNJiB9Qiy-b_EDkDa0LmnWTtNyxWUONoFljWl3EldGdBc';
const KEEP_SENT_MS = 4 * 86400000;

async function main(){
  // Until both secrets exist, do nothing instead of failing every 5 minutes.
  const missing = ['FIREBASE_SERVICE_ACCOUNT', 'VAPID_PRIVATE_KEY'].filter(n => !process.env[n]);
  if(missing.length){ console.log(`Faltan secretos en GitHub (${missing.join(', ')}); no se envía nada.`); return; }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  webpush.setVapidDetails('https://jgm94.github.io/casa-a-medias/', VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const db = admin.firestore();

  const [settingsSnap, tasksSnap, subsSnap, logSnap] = await Promise.all([
    db.doc('settings/general').get(),
    db.collection('tasks').get(),
    db.collection('pushSubs').get(),
    db.doc('pushState/log').get()
  ]);
  if(!settingsSnap.exists || subsSnap.empty){ console.log('Nada que hacer.'); return; }

  const subs = subsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const byPerson = {};
  for(const s of subs) (byPerson[s.person] = byPerson[s.person] || []).push(s);

  const sent = logSnap.exists ? { ...(logSnap.data().sent || {}) } : {};
  const due = plan({
    settings: settingsSnap.data(),
    tasks: tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    people: Object.keys(byPerson),
    sent,
    now: new Date()
  });

  let delivered = 0;
  for(const n of due){
    for(const s of byPerson[n.person]){
      try{
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(n.payload), { TTL: 3600, urgency: 'high' });
        delivered++;
      }catch(err){
        if(err.statusCode === 404 || err.statusCode === 410) await db.doc(`pushSubs/${s.id}`).delete();
        else console.error(`Fallo al enviar a ${n.person}: ${err.statusCode || ''} ${err.body || err.message}`);
      }
    }
    sent[n.key] = Date.now();
  }

  let pruned = false;
  for(const [k, t] of Object.entries(sent)){
    if(Date.now() - t > KEEP_SENT_MS){ delete sent[k]; pruned = true; }
  }
  if(due.length || pruned) await db.doc('pushState/log').set({ sent });
  console.log(`${due.length} avisos, ${delivered} entregas.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
