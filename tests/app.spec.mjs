// Pruebas de que la app no pierde datos. Corren contra los emuladores de Firebase:
//   npm test
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Datos con la misma forma que la app vieja (nombres cambiados) y las cuentas que ella daba con ellos.
const VIEJOS = JSON.parse(readFileSync('tests/datos/datos-prueba.json', 'utf8'));
const CUENTAS_VIEJAS = JSON.parse(readFileSync('tests/datos/cuentas-app-vieja.json', 'utf8'));
const URL = '/?emulador';
const CORREO = 'maira@prueba.com';

const BASE = 'http://127.0.0.1:8080/v1/projects/demo-postres/databases/(default)/documents';
async function limpiarBase() {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-postres/databases/(default)/documents', { method: 'DELETE' });
  // Igual que en la base real: solo entran los correos que tienen documento en "acceso".
  const r = await fetch(BASE + '/acceso/' + CORREO, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { nombre: { stringValue: 'Maira' } } }),
  });
  if (!r.ok) throw new Error('no se pudo preparar acceso: ' + r.status);
}
async function abrir(browser, correo = CORREO, opciones = {}) {
  const ctx = await browser.newContext(opciones);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERROR EN PÁGINA:', e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__entrarPrueba);
  await page.evaluate((c) => window.__entrarPrueba(c), correo);
  return { ctx, page };
}
async function listo(page) {
  await expect(page.locator('.nav')).toBeVisible({ timeout: 20000 });
}
async function subido(page) {
  await page.waitForFunction(() => !window.__app.DB.cambiosPendientes(), null, { timeout: 20000 });
}
const totales = (page) => page.evaluate(() => window.__app.totales());
const cortarNube = (ctx) => ctx.route(/127\.0\.0\.1:8080/, (r) => r.abort());
const volverNube = (ctx) => ctx.unroute(/127\.0\.0\.1:8080/);

test.beforeEach(limpiarBase);

test('trae los datos de la app vieja y da las mismas cuentas', async ({ browser }) => {
  const esperado = CUENTAS_VIEJAS.totales;
  const { page } = await abrir(browser);
  await listo(page);
  await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(page);
  expect(await totales(page)).toEqual(esperado);
  const otras = await page.evaluate(() => ({ saldos: window.__app.saldosPorCliente(), sabores: window.__app.ventasPorSabor(),
    r1: window.__app.resumenRonda('r1'), r2: window.__app.resumenRonda('r2') }));
  for (const k of ['saldos', 'sabores', 'r1', 'r2']) expect(otras[k]).toEqual(CUENTAS_VIEJAS[k]);
  await expect(page.locator('.kpi').first()).toContainText('$350.000');

  // Al recargar, todo sigue ahí
  await page.reload();
  await listo(page);
  expect(await totales(page)).toEqual(esperado);
});

test('un pedido hecho sin señal sobrevive a cerrar la app y se sube al volver la señal', async ({ browser }) => {
  const { ctx, page } = await abrir(browser);
  await listo(page);
  await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(page);
  const antes = (await totales(page)).pedidos;

  await cortarNube(ctx);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  // Registrar un pedido usando la pantalla, como lo haría Maira
  await page.locator('.fab').click();
  await page.locator('select[data-in="clienteId"]').selectOption({ label: 'Cliente 7' });
  const filaLimon = page.locator('.sheet .item', { hasText: 'Postre de limón' });
  await filaLimon.locator('button.pl').click();
  await page.getByRole('button', { name: 'Pagó todo' }).click();
  await page.getByRole('button', { name: 'Guardar pedido' }).click();
  await expect(page.locator('#nube')).not.toContainText('Guardado');
  expect((await totales(page)).pedidos).toBe(antes + 1);
  // El pedido ya quedó guardado en el celular (no solo en pantalla)
  await page.waitForFunction((n) => Object.keys(window.__app.DB.exportar().pedidos).length === n, antes + 1);

  // Cerrar y volver a abrir sin señal: el pedido sigue en el celular
  await page.reload();
  await listo(page);
  expect((await totales(page)).pedidos).toBe(antes + 1);
  // Y no dice "Guardado": sabe que hay cambios esperando para subir
  expect(await page.evaluate(() => window.__app.DB.cambiosPendientes())).toBe(true);
  await expect(page.locator('#nube')).not.toContainText('✓ Guardado');

  // Vuelve la señal: se sube solo y otro celular lo ve
  await volverNube(ctx);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const otro = await abrir(browser);
  await listo(otro.page);
  await expect.poll(async () => (await totales(otro.page)).pedidos, { timeout: 30000 }).toBe(antes + 1);
});

test('dos celulares anotando pagos del mismo pedido a la vez no se pisan', async ({ browser }) => {
  const a = await abrir(browser);
  await listo(a.page);
  await a.page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(a.page);
  const b = await abrir(browser);
  await listo(b.page);
  await expect.poll(() => b.page.evaluate(() => Object.keys(window.__app.S.pedidos).length)).toBe(19);

  // p18 no tiene pagos. Los dos celulares, sin señal, anotan un abono distinto.
  await cortarNube(a.ctx); await cortarNube(b.ctx);
  for (const [x, monto] of [[a, '3000'], [b, '4000']]) {
    await x.page.evaluate(() => window.__app.abrir('verPedido', { id: 'p18' }));
    await x.page.locator('input[data-in="gpv"]').fill(monto);
    await x.page.getByRole('button', { name: 'Añadir' }).click();
  }
  await volverNube(a.ctx); await volverNube(b.ctx);
  await subido(a.page); await subido(b.page);
  for (const x of [a, b]) {
    await expect.poll(() => x.page.evaluate(() => window.__app.pPagado(window.__app.S.pedidos.p18)), { timeout: 30000 }).toBe(7000);
  }
});

test('eliminar manda a la papelera y se puede recuperar', async ({ browser }) => {
  const { page } = await abrir(browser);
  await listo(page);
  await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(page);
  await page.evaluate(() => window.__app.abrir('verPedido', { id: 'p01' }));
  const borrar = page.getByRole('button', { name: /liminar/i });
  await borrar.click(); await borrar.click();
  await subido(page);
  expect(await page.evaluate(() => !!window.__app.S.pedidos.p01)).toBe(false);

  await page.evaluate(() => window.__app.setTab('mas'));
  await page.getByRole('button', { name: /Papelera/ }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Recuperar' }).first().click();
  await subido(page);
  await page.reload();
  await listo(page);
  expect(await page.evaluate(() => !!window.__app.S.pedidos.p01)).toBe(true);
});

test('una cuenta que no está autorizada no ve nada', async ({ browser }) => {
  const { page } = await abrir(browser, 'extrano@prueba.com');
  await expect(page.getByText('Esta cuenta no tiene permiso')).toBeVisible({ timeout: 20000 });
});

test('nadie puede borrar datos de verdad, ni siquiera con permiso', async ({ browser }) => {
  const { page } = await abrir(browser);
  await listo(page);
  await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(page);
  const r = await page.evaluate(() => window.__app.DB.__borrarDeVerdad('pedidos', 'p01').then(() => 'borró', (e) => e.code));
  expect(r).toBe('permission-denied');
});

test('editar un pedido sin señal no borra el pago que otro celular anotó', async ({ browser }) => {
  const a = await abrir(browser);
  await listo(a.page);
  await a.page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(a.page);
  const b = await abrir(browser);
  await listo(b.page);
  await expect.poll(() => b.page.evaluate(() => Object.keys(window.__app.S.pedidos).length)).toBe(19);

  // B, sin señal, edita la nota del pedido p18 (que no tiene pagos)
  await cortarNube(b.ctx);
  await b.page.evaluate(() => window.__app.abrir('verPedido', { id: 'p18' }));
  await b.page.getByRole('button', { name: /Editar este pedido/ }).click();
  await b.page.locator('input[data-in="notas"]').fill('entregar en la tarde');
  await b.page.getByRole('button', { name: 'Guardar cambios' }).click();

  // Mientras tanto A, con señal, anota un pago y lo marca entregado
  await a.page.evaluate(() => window.__app.abrir('verPedido', { id: 'p18' }));
  await a.page.locator('input[data-in="gpv"]').fill('4000');
  await a.page.getByRole('button', { name: 'Añadir' }).click();
  await subido(a.page);

  // Vuelve la señal de B: queda la nota de B Y el pago de A
  await volverNube(b.ctx);
  await subido(b.page);
  for (const x of [a, b]) {
    await expect.poll(() => x.page.evaluate(() => {
      const p = window.__app.S.pedidos.p18;
      return [window.__app.pPagado(p), p.notas];
    }), { timeout: 30000 }).toEqual([4000, 'entregar en la tarde']);
  }
});

test('traer otra vez un respaldo viejo no deshace lo que se anotó después', async ({ browser }) => {
  const { ctx, page } = await abrir(browser);
  await listo(page);
  const r1 = await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  expect(r1.nuevos).toBe(4 + 16 + 2 + 19 + 12 + 1);
  await page.evaluate(() => window.__app.abrir('verPedido', { id: 'p18' }));
  await page.locator('input[data-in="gpv"]').fill('4000');
  await page.getByRole('button', { name: 'Añadir' }).click();
  await page.evaluate(() => { window.__app.cerrar(); window.__app.DB.borrar('pedidos', 'p07'); });
  await subido(page);

  const r2 = await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  expect(r2.nuevos).toBe(0);
  expect(r2.yaEstaban).toBe(r1.nuevos);
  await page.reload();
  await listo(page);
  expect(await page.evaluate(() => window.__app.pPagado(window.__app.S.pedidos.p18))).toBe(4000);
  expect(await page.evaluate(() => !!window.__app.S.pedidos.p07)).toBe(false);

  // Sin señal no deja traer un respaldo (no puede saber qué existe)
  await ctx.setOffline(true);
  const sin = await page.evaluate((d) => window.__app.DB.importar(d).then(() => 'importó', (e) => e.code), VIEJOS);
  expect(sin).toBe('sin-senal');
});

test('el historial guarda cómo estaba antes de cada cambio', async ({ browser }) => {
  const { page } = await abrir(browser);
  await listo(page);
  await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(page);
  await page.evaluate(() => window.__app.setTab('sabores'));
  await page.locator('.card.tap', { hasText: 'Pavé de Milo' }).click();
  await page.locator('input[data-in="precio"]').fill('12000');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await subido(page);
  const h = await page.evaluate(() => window.__app.DB.historial(5));
  const ult = h.find((x) => x.col === 'catalogo' && x.id === 's3');
  expect(ult.accion).toBe('editar');
  expect(ult.antes.precio).toBe(10000);
  expect(ult.despues.precio).toBe(12000);
});

test('un celular nuevo sin señal no muestra un negocio vacío como si fuera el real', async ({ browser }) => {
  const a = await abrir(browser);
  await listo(a.page);
  await a.page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(a.page);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__entrarPrueba);
  await cortarNube(ctx);
  await page.evaluate((c) => window.__entrarPrueba(c), CORREO);
  await expect(page.getByText('Bajando tus datos de la nube')).toBeVisible({ timeout: 30000 });
  await volverNube(ctx);
  await listo(page);
  expect((await totales(page)).pedidos).toBe(19);
});

test('la app abre sin nada de señal después de la primera vez', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, CORREO, { serviceWorkers: 'allow' });
  await listo(page);
  await page.evaluate((d) => window.__app.DB.importar(d), VIEJOS);
  await subido(page);
  // Espera a que la copia de la app quede guardada en el celular
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await listo(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await ctx.setOffline(true);
  await page.reload();
  await listo(page);
  expect((await totales(page)).pedidos).toBe(19);
  await expect(page.locator('.kpi').first()).toContainText('$350.000');
});
