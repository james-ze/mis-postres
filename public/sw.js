// Guarda una copia de la app en el celular para que abra aunque no haya señal.
// Cada versión guarda sus propios archivos juntos (la página y su app.js), así nunca
// se mezcla una página nueva con un app.js viejo.
const PREFIJO = 'mis-postres-';
const CACHE = PREFIJO + '__VERSION__';
const FUENTES = 'mis-postres-fuentes';
const ARCHIVOS = ['./', 'app.js?v=__VERSION__', 'estilos.css?v=__VERSION__', 'manifest.webmanifest', 'icono.svg', 'icono-192.png'];
const ESPERA_RED = 3500; // con señal mala no se queda esperando: abre la copia

self.addEventListener('install', (e) => {
  // cache: 'reload' para no guardar una versión vieja que el navegador tenga guardada.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ARCHIVOS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // Solo borra versiones viejas de ESTA app (en github.io el sitio se comparte con otras).
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIJO) && k !== CACHE && k !== FUENTES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function conLimite(promesa, ms) {
  return new Promise((ok, mal) => {
    const t = setTimeout(() => mal(new Error('lento')), ms);
    promesa.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); mal(e); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // La página: primero internet (máximo unos segundos); si no, la copia de esta versión.
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(conLimite(fetch(req), ESPERA_RED)
      .then((r) => (r.ok ? r : caches.open(CACHE).then((c) => c.match('./')).then((m) => m || r)))
      .catch(() => caches.open(CACHE).then((c) => c.match('./')))
      .then((r) => r || Response.error()));
    return;
  }

  // Archivos de la app (app.js, estilos, iconos): primero la copia, que nunca cambia por versión.
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((m) => m || fetch(req)));
    return;
  }

  // Letra de Google: la copia de una vez y se actualiza por detrás.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FUENTES).then((c) => c.match(req).then((m) => {
      const red = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; });
      if (m) { red.catch(() => {}); return m; }
      return red;
    })));
  }
});
