// Capa de datos: guarda todo en Firestore (la base de datos en la nube de Google).
//
// Reglas que hacen que no se pierda nada:
//  - Cada sabor, cliente, ronda, pedido y gasto es su propio documento. Nunca se
//    reescribe "todo de una vez", así que un error solo puede tocar un registro.
//  - Editar solo cambia los campos del formulario. Pagos y mermas se agregan y quitan
//    uno por uno, así lo que anota otro celular al mismo tiempo no se pisa.
//  - Nada se borra de verdad: eliminar marca el registro con _borrado y queda en la
//    papelera. Las reglas de la base de datos ni siquiera permiten borrar.
//  - Cada cambio deja una copia de cómo estaba antes y cómo quedó en "historial".
//  - Firestore guarda una copia en el celular: sin señal todo sigue funcionando y
//    los cambios se suben solos la próxima vez que la app esté abierta con señal.
import { initializeApp, onLog } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, connectAuthEmulator,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator, collection, doc, onSnapshot, writeBatch, serverTimestamp,
  arrayUnion, arrayRemove, query, orderBy, limit, getDocs, getDocsFromServer, deleteDoc,
} from 'firebase/firestore';
import { firebaseConfig, NEGOCIO } from './config.js';

export const COLECCIONES = ['catalogo', 'clientes', 'rondas', 'pedidos', 'gastos', 'config'];

const enLocal = typeof location !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]emulador\b/.test(location.search);

let auth, db, usuario = null;
let pendientes = 0, ultimoError = null, sinCacheLocal = false;
const datos = {}, papelera = {}, listos = new Set(), desdeServidor = new Set();
let pendientesNube = {};   // colección -> tiene cambios guardados en el celular que aún no suben
let sinCopiaLocal = {};    // colección -> cambios recién hechos que aún no quedan guardados ni en el celular
let confiableAvisado = false;
let desuscribir = [];
let cb = {};

// Hay cambios sin subir si este rato se mandó algo que no ha llegado, o si Firestore
// dice que tiene cambios en cola (por ejemplo, anotados antes de cerrar la app sin señal).
function hayPendientes() {
  return pendientes > 0 || Object.keys(pendientesNube).some((c) => pendientesNube[c]);
}
function estado() {
  if (ultimoError) return 'error';
  if (hayPendientes()) return (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'sinsenal' : 'guardando';
  return 'ok';
}
function avisarEstado() { cb.onEstado && cb.onEstado(estado(), ultimoError); }

function llaveSincronizado() { return 'mis-postres.sincronizado.' + (usuario ? usuario.uid : ''); }
function yaSincronizo() { try { return localStorage.getItem(llaveSincronizado()) === '1'; } catch (e) { return false; } }
function marcarSincronizado() { try { localStorage.setItem(llaveSincronizado(), '1'); } catch (e) { /* no importa */ } }
// Los datos que se muestran son de fiar si ya llegaron de la nube, ahora o alguna vez en este celular.
function confiable() { return desdeServidor.size === COLECCIONES.length || yaSincronizo(); }

export function iniciar(callbacks) {
  cb = callbacks;
  // Si el celular no deja guardar la copia local, Firestore sigue solo en memoria y lo
  // avisa en este mensaje. Lo detectamos para advertirle a Maira.
  onLog(({ message }) => {
    if (/Falling back to memory cache/.test(message || '') && !sinCacheLocal) {
      sinCacheLocal = true;
      cb.onCacheLocal && cb.onCacheLocal(false);
    }
  }, { level: 'warn' });

  const conf = enLocal ? { ...firebaseConfig, apiKey: 'demo', projectId: 'demo-postres', authDomain: 'localhost' } : firebaseConfig;
  const app = initializeApp(conf);
  // Sin el ayudante de ventanas de Google al arrancar: así la app abre rápido aunque la
  // señal esté mala. El ayudante solo se usa al tocar "Entrar con Google".
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (enLocal) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    window.__entrarPrueba = (email) => signInWithCredential(auth, GoogleAuthProvider.credential(
      JSON.stringify({ sub: email, email, email_verified: true })));
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', avisarEstado);
    window.addEventListener('offline', avisarEstado);
    window.addEventListener('beforeunload', (e) => {
      // Solo avisa si hay cambios que todavía no quedaron guardados ni en el celular.
      const recien = Object.keys(sinCopiaLocal).some((c) => sinCopiaLocal[c] > 0);
      if (recien || (hayPendientes() && sinCacheLocal)) { e.preventDefault(); e.returnValue = ''; }
    });
  }
  onAuthStateChanged(auth, (u) => {
    usuario = u;
    desuscribir.forEach((f) => f()); desuscribir = [];
    listos.clear(); desdeServidor.clear(); pendientesNube = {}; confiableAvisado = false;
    cb.onUsuario && cb.onUsuario(u);
    if (u) {
      // Pide al navegador que no borre la copia del celular cuando le falte espacio.
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* no importa */ }
      escuchar();
    }
  });
}

function ref(col, id) { return doc(db, 'negocios', NEGOCIO, col, id); }
function refHistorial() { return doc(collection(db, 'negocios', NEGOCIO, 'historial')); }

function limpiar(d) {
  const o = {};
  Object.keys(d).forEach((k) => { if (k[0] !== '_') o[k] = d[k]; });
  return o;
}

function escuchar() {
  COLECCIONES.forEach((col) => {
    datos[col] = {}; papelera[col] = {};
    const f = onSnapshot(collection(db, 'negocios', NEGOCIO, col), { includeMetadataChanges: true }, (snap) => {
      pendientesNube[col] = snap.metadata.hasPendingWrites;
      if (snap.metadata.hasPendingWrites) sinCopiaLocal[col] = 0; // ya quedó guardado en el celular
      if (!snap.metadata.fromCache) desdeServidor.add(col);
      const primera = !listos.has(col);
      const cambiaron = primera || snap.docChanges().length > 0;
      if (cambiaron) {
        const vivos = {}, borrados = {};
        snap.forEach((d) => {
          const v = d.data({ serverTimestamps: 'estimate' });
          if (v._borrado) borrados[d.id] = { ...limpiar(v), _cuando: v._actualizado && v._actualizado.toMillis ? v._actualizado.toMillis() : null };
          else vivos[d.id] = limpiar(v);
        });
        datos[col] = vivos; papelera[col] = borrados;
      }
      listos.add(col);
      if (desdeServidor.size === COLECCIONES.length) marcarSincronizado();
      avisarEstado();
      if (listos.size !== COLECCIONES.length) return;
      const ok = confiable();
      if (cambiaron || (ok && !confiableAvisado)) {
        confiableAvisado = ok;
        cb.onDatos && cb.onDatos(datos, papelera, { confiable: ok });
      }
    }, (err) => {
      if (err.code === 'permission-denied') { cb.onSinPermiso && cb.onSinPermiso(usuario && usuario.email); return; }
      ultimoError = 'No se pudieron leer los datos: ' + err.message;
      avisarEstado();
      // Si falló antes de mostrar nada, no dejamos la pantalla de carga para siempre.
      if (!listos.has(col)) cb.onFalloCarga && cb.onFalloCarga(ultimoError);
    });
    desuscribir.push(f);
  });
}

function huella() {
  return { _actualizado: serverTimestamp(), _por: (usuario && usuario.email) || '' };
}
function copia(x) { return x == null ? null : JSON.parse(JSON.stringify(x)); }
function actual(col, id) { return copia((datos[col] && datos[col][id]) || null); }

function enviar(batch, que, cols) {
  pendientes++;
  (cols || []).forEach((c) => { sinCopiaLocal[c] = (sinCopiaLocal[c] || 0) + 1; });
  avisarEstado();
  const listo = () => { pendientes--; (cols || []).forEach((c) => { sinCopiaLocal[c] = 0; }); };
  return batch.commit().then(() => {
    listo(); ultimoError = null; avisarEstado();
    return true;
  }, (err) => {
    listo();
    ultimoError = (err.code === 'permission-denied')
      ? 'Esta cuenta no tiene permiso para guardar.'
      : 'No se pudo guardar ' + que + ': ' + err.message;
    avisarEstado();
    cb.onError && cb.onError(ultimoError);
    return false;
  });
}

function anotar(batch, col, id, accion, antes, despues) {
  batch.set(refHistorial(), {
    col, id, accion, antes: copia(antes), despues: copia(despues),
    por: (usuario && usuario.email) || '', cuando: serverTimestamp(),
  });
}

export function nuevoId(col) { return doc(collection(db, 'negocios', NEGOCIO, col)).id; }

// Guarda un registro. Si es nuevo lo crea completo; si ya existe, solo cambia los
// campos que vienen (nunca lo saca de la papelera ni toca pagos o mermas).
// No espera a la nube: con señal se sube enseguida, sin señal queda en el celular.
export function guardar(col, id, cuerpo) {
  const antes = actual(col, id);
  const limpio = copia(cuerpo);
  const b = writeBatch(db);
  if (antes) {
    b.set(ref(col, id), { ...limpio, ...huella() }, { merge: true });
    anotar(b, col, id, 'editar', antes, { ...antes, ...limpio });
  } else {
    b.set(ref(col, id), { ...limpio, _borrado: false, ...huella() }, { merge: true });
    anotar(b, col, id, 'crear', null, limpio);
  }
  return enviar(b, 'el cambio', [col]);
}

// Cambia solo algunos campos (por ejemplo "entregado"), sin tocar el resto.
export function actualizar(col, id, campos) {
  const antes = actual(col, id);
  const b = writeBatch(db);
  b.set(ref(col, id), { ...copia(campos), ...huella() }, { merge: true });
  anotar(b, col, id, 'editar', antes, antes ? { ...antes, ...copia(campos) } : copia(campos));
  return enviar(b, 'el cambio', [col]);
}

// Guarda la edición de un pedido: los campos del formulario y, aparte, los pagos que
// se agregaron o quitaron en el formulario (sin reescribir la lista entera).
export function editarPedido(id, campos, agregados, quitados) {
  const antes = actual('pedidos', id);
  const b = writeBatch(db);
  b.set(ref('pedidos', id), { ...copia(campos), ...huella() }, { merge: true });
  if (quitados.length) b.update(ref('pedidos', id), { pagos: arrayRemove(...copia(quitados)), ...huella() });
  if (agregados.length) b.update(ref('pedidos', id), { pagos: arrayUnion(...copia(agregados)), ...huella() });
  anotar(b, 'pedidos', id, 'editar', antes, { campos: copia(campos), pagosAgregados: copia(agregados), pagosQuitados: copia(quitados) });
  return enviar(b, 'el pedido', ['pedidos']);
}

export function borrar(col, id) {
  const antes = actual(col, id);
  const b = writeBatch(db);
  b.set(ref(col, id), { _borrado: true, ...huella() }, { merge: true });
  anotar(b, col, id, 'eliminar', antes, null);
  return enviar(b, 'la eliminación', [col]);
}

export function restaurar(col, id) {
  const b = writeBatch(db);
  b.set(ref(col, id), { _borrado: false, ...huella() }, { merge: true });
  anotar(b, col, id, 'restaurar', null, limpiar((papelera[col] && papelera[col][id]) || {}));
  return enviar(b, 'la restauración', [col]);
}

// Pagos y mermas: se agregan y quitan uno por uno, así dos celulares anotando en el
// mismo pedido o ronda al mismo tiempo no se pisan. Cada uno lleva su propio id.
export function agregarPago(pid, pago) {
  const b = writeBatch(db);
  b.update(ref('pedidos', pid), { pagos: arrayUnion(copia(pago)), ...huella() });
  anotar(b, 'pedidos', pid, 'pago', null, pago);
  return enviar(b, 'el pago', ['pedidos']);
}
export function quitarPago(pid, pago) {
  const b = writeBatch(db);
  b.update(ref('pedidos', pid), { pagos: arrayRemove(copia(pago)), ...huella() });
  anotar(b, 'pedidos', pid, 'quitar pago', pago, null);
  return enviar(b, 'el cambio del pago', ['pedidos']);
}
export function agregarMerma(rid, merma) {
  const b = writeBatch(db);
  b.update(ref('rondas', rid), { merma: arrayUnion(copia(merma)), ...huella() });
  anotar(b, 'rondas', rid, 'merma', null, merma);
  return enviar(b, 'la merma', ['rondas']);
}

// Trae un respaldo (de la app vieja o de esta). Solo AGREGA lo que no existe todavía:
// lo que ya está en la nube (o en la papelera) no se toca. Necesita señal, porque
// tiene que preguntarle a la nube qué existe.
const ID_VALIDO = /^[A-Za-z0-9_-]{1,100}$/;
export async function importar(obj) {
  const existentes = {};
  const sinSenal = () => { const err = new Error('Necesitas señal para traer un respaldo.'); err.code = 'sin-senal'; return err; };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw sinSenal();
  try {
    for (const col of COLECCIONES) {
      const s = await getDocsFromServer(collection(db, 'negocios', NEGOCIO, col));
      existentes[col] = new Set(s.docs.map((d) => d.id));
    }
  } catch (e) {
    throw sinSenal();
  }
  const r = { nuevos: 0, yaEstaban: 0, invalidos: 0, fallidos: 0 };
  const ops = [];
  COLECCIONES.forEach((col) => {
    let fuente = obj[col];
    if (col === 'config' && fuente && !fuente.app) fuente = { app: fuente };
    if (!fuente || typeof fuente !== 'object') return;
    Object.keys(fuente).forEach((id) => {
      const v = fuente[id];
      if (!v || typeof v !== 'object' || !ID_VALIDO.test(id)) { r.invalidos++; return; }
      if (existentes[col].has(id)) { r.yaEstaban++; return; }
      const limpio = limpiar(copia(v));
      // Los pagos y mermas de la app vieja no traen id; se lo damos para poder quitar uno solo.
      ['pagos', 'merma'].forEach((campo) => {
        if (Array.isArray(limpio[campo])) {
          limpio[campo] = limpio[campo].map((x, i) => (x && typeof x === 'object' && !x.id) ? { ...x, id: 'legado-' + id + '-' + i } : x);
        }
      });
      ops.push([col, id, limpio]);
    });
  });
  const envios = [];
  for (let i = 0; i < ops.length; i += 200) {
    const parte = ops.slice(i, i + 200);
    const b = writeBatch(db);
    parte.forEach(([col, id, v]) => {
      b.set(ref(col, id), { ...v, _borrado: false, ...huella() });
      anotar(b, col, id, 'importar', null, v);
    });
    envios.push(enviar(b, 'el respaldo', [...new Set(parte.map((o) => o[0]))]).then((ok) => { if (ok) r.nuevos += parte.length; else r.fallidos += parte.length; }));
  }
  await Promise.all(envios);
  return r;
}

export function exportar() {
  const o = { v: 2, app: 'mis-postres', exportado: new Date().toISOString(), papelera: copia(papelera) };
  COLECCIONES.forEach((c) => { o[c] = copia(datos[c] || {}); });
  o.config = (datos.config && datos.config.app) || {};
  return o;
}

export async function historial(n) {
  const q = query(collection(db, 'negocios', NEGOCIO, 'historial'), orderBy('cuando', 'desc'), limit(n || 30));
  const s = await getDocs(q);
  return s.docs.map((d) => d.data());
}

export async function entrar() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, p, browserPopupRedirectResolver); }
  catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-blocked') {
      const err = new Error('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para esta página y vuelve a tocar Entrar.');
      err.code = e.code;
      throw err;
    }
    throw e;
  }
}
export function salir() { return signOut(auth); }
export function hayCacheLocal() { return !sinCacheLocal; }
export function correo() { return usuario && usuario.email; }
export function cambiosPendientes() { return hayPendientes(); }

// Solo para las pruebas: intenta un borrado real, que las reglas deben rechazar.
export function __borrarDeVerdad(col, id) {
  if (!enLocal) return Promise.reject(new Error('solo en pruebas'));
  return deleteDoc(ref(col, id));
}
