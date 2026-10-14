// Descarga TODOS los datos del negocio (incluida la papelera y el historial) a un archivo.
// Uso: FIREBASE_CUENTA_SERVICIO='<json de la cuenta de servicio>' node scripts/respaldo.mjs salida.json
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync } from 'node:fs';
import { firebaseConfig, NEGOCIO } from '../src/config.js';

const cuenta = JSON.parse(process.env.FIREBASE_CUENTA_SERVICIO || '{}');
if (!process.env.FIRESTORE_EMULATOR_HOST && cuenta.project_id !== firebaseConfig.projectId) {
  console.error('La cuenta de servicio es del proyecto "' + cuenta.project_id + '", pero la app usa "' + firebaseConfig.projectId + '".');
  process.exit(1);
}
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: 'demo-postres' } : { credential: cert(cuenta) });
const db = getFirestore();

const salida = { v: 2, exportado: new Date().toISOString(), proyecto: cuenta.project_id, papelera: {} };
const raiz = db.collection('negocios').doc(NEGOCIO);
for (const col of await raiz.listCollections()) {
  const snap = await col.get();
  const vivos = {}, borrados = {};
  snap.forEach((d) => {
    const v = JSON.parse(JSON.stringify(d.data()));
    if (v._borrado) borrados[d.id] = v; else vivos[d.id] = v;
  });
  salida[col.id] = vivos;
  if (Object.keys(borrados).length) salida.papelera[col.id] = borrados;
  console.log(col.id + ': ' + snap.size);
}
if (salida.config && salida.config.app) salida.config = salida.config.app;
// Un respaldo vacío no sirve: mejor que el trabajo falle y GitHub avise por correo.
const cuantos = ['catalogo', 'pedidos'].reduce((n, c) => n + Object.keys(salida[c] || {}).length, 0);
if (!cuantos) { console.error('No se encontraron sabores ni pedidos: el respaldo saldría vacío.'); process.exit(1); }
writeFileSync(process.argv[2] || 'respaldo.json', JSON.stringify(salida, null, 1));
