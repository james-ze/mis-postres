# Mis Postres

App para llevar el negocio de postres: pedidos, rondas de producción, sabores, clientes, gastos y quién debe.

## Por qué esta versión no pierde datos

| Antes | Ahora |
|---|---|
| Los datos vivían solo en el navegador de un celular. Borrar el historial o cambiar de celular los perdía. | Los datos viven en la nube de Google (Firestore) y además en una copia dentro del celular. |
| Al actualizar la app, los datos venían "adentro" y reemplazaban lo que ella había anotado. | La app y los datos están separados. Actualizar la app nunca toca los datos. |
| Sin señal no se podía confiar en lo guardado. | Sin señal todo funciona; los cambios quedan guardados en el celular (aunque cierre la app) y se suben la próxima vez que la abra con señal. Arriba siempre dice si quedó todo guardado. |
| Eliminar era para siempre. | Eliminar manda a la **Papelera** (Más › Papelera) y se puede recuperar. La base de datos no permite borrar de verdad. |
| No había registro de cambios. | Cada cambio queda en el **historial** con cómo estaba antes, quién lo hizo y cuándo. |
| Un solo celular. | Entra desde cualquier celular o computador con la cuenta de Google autorizada. Si dos celulares anotan pagos o mermas a la vez, no se pisan. |
| Dependía de Claude. | Código en este repositorio, publicado gratis en GitHub Pages. |

Todo es gratis: el plan gratuito de Firebase (Spark) no se vence ni se pausa por falta de uso, y lo que gasta este negocio queda muy por debajo de los límites.

## Puesta en marcha (una sola vez)

### 1. Firebase (la base de datos)

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google y toca **Crear un proyecto**. Nombre: `mis-postres`. Google Analytics: desactivado.
2. **Agregar app › Web (`</>`)**. Apodo: `mis-postres`. No marques Hosting. Copia el bloque `firebaseConfig` que aparece y pégalo en [`src/config.js`](src/config.js) (o envíaselo a Claude).
3. Menú **Compilación › Authentication › Comenzar**. En *Método de acceso* activa **Google** y guarda.
4. En **Authentication › Configuración › Dominios autorizados** agrega `james-ze.github.io`.
5. Menú **Compilación › Firestore Database › Crear base de datos**. Edición estándar, ubicación `southamerica-east1 (São Paulo)`, **modo de producción**.
6. En la pestaña **Reglas** de Firestore borra todo y pega el contenido de [`firestore.rules`](firestore.rules), pero con los correos que pueden entrar dentro de `correosPermitidos()`, en minúsculas. Por ejemplo `return ['maira@gmail.com', 'tu-correo@gmail.com'];`. Toca **Publicar**. (Claude te las puede dar ya armadas.)

Solo esos correos pueden entrar. Para dar o quitar acceso más adelante, cambia la lista y vuelve a publicar. Los correos no se escriben en este repositorio porque es público.

### 2. GitHub Pages (la página)

1. En este repositorio: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
2. Cada vez que se sube un cambio a `main`, GitHub corre las pruebas y, si pasan, publica la app en `https://james-ze.github.io/mis-postres/`. Si una prueba falla, la versión publicada sigue igual.

Comparte el link siempre con la barra `/` al final: sin ella la app no abre cuando no hay señal.

### 3. Pasar los datos de la app anterior

1. En la app anterior (la de Claude), en el celular de Maira: **Más › Respaldo y recuperación › Descargar respaldo**. Si no descarga, copia el texto que aparece.
2. En la app nueva: entra con Google, ve a **Más › Respaldo › Traer datos del respaldo**, elige el archivo (o pega el texto) y toca dos veces el botón.
3. Si el respaldo del celular no aparece, Claude guardó aparte (fuera de este repositorio, porque es público) lo que tenía la app vieja al 18 de septiembre de 2026. Sirve igual, pero le faltaría lo que ella anotó después.

Traer un respaldo solo **agrega** lo que no existe todavía. Lo que ya está en la app (o en la papelera) no se toca, así que traer un respaldo viejo nunca deshace lo que se anotó después. Necesita señal.

### 4. En el celular de Maira

Abre el link en Chrome, entra con su Gmail y toca **⋮ › Agregar a la pantalla principal**. Queda un ícono que abre la app en Chrome. La primera vez en cada celular se necesita internet para bajar los datos; después funciona sin señal.

## Respaldo diario automático (opcional, recomendado)

Además de la nube, cada noche puede quedar una copia cifrada en la rama `respaldos` de este repositorio.

1. Firebase › ⚙️ Configuración del proyecto › **Cuentas de servicio** › **Generar nueva clave privada**. Se descarga un archivo `.json`.
2. En GitHub: **Settings › Secrets and variables › Actions › New repository secret**:
   - `FIREBASE_CUENTA_SERVICIO`: todo el contenido de ese archivo `.json`.
   - `RESPALDO_CLAVE`: una contraseña larga que guardes en un lugar seguro. Sin ella no se pueden abrir los respaldos.
3. Borra el archivo `.json` de tu computador.

Se guardan los respaldos de los últimos 30 días. Si el trabajo falla (por ejemplo, porque el respaldo saldría vacío), GitHub te avisa por correo.

Para abrir un respaldo:

1. En GitHub, cambia a la rama `respaldos`, abre `ultimo.json.gz.enc` (o el de un día en `diarios/`) y toca **Download raw file**.
2. En una terminal (en Windows, en *Git Bash*), en la carpeta donde quedó el archivo:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ultimo.json.gz.enc | gunzip > respaldo.json
   ```
   Te pide la clave (`RESPALDO_CLAVE`) y crea `respaldo.json`.
3. Ese archivo se puede traer desde la app (Más › Respaldo). Recuerda que solo agrega lo que falte.

## Para desarrollar

```bash
npm install
npm test        # prueba todo contra una copia local de Firebase (necesita Java)
npm run build   # arma dist/
```

Abrir `http://localhost:5173/?emulador` con los emuladores corriendo usa datos de prueba, nunca los reales.

- `src/app.js`: pantallas y cuentas (igual que la app anterior).
- `src/db.js`: guardado en Firestore, papelera, historial y modo sin señal.
- `firestore.rules`: quién entra y qué se puede hacer (no se permite borrar).
- `tests/`: pruebas de que no se pierden datos.
