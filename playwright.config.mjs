import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chromium = '/opt/pw-browsers/chromium';
export default defineConfig({
  testDir: 'tests',
  timeout: 90000,
  workers: 1,
  // Sin service worker por defecto: si no, las pruebas no pueden "cortar la señal" con route().
  use: { baseURL: 'http://localhost:5173', viewport: { width: 390, height: 844 }, serviceWorkers: 'block',
    launchOptions: existsSync(chromium) ? { executablePath: chromium } : {} },
  webServer: { command: 'python3 -m http.server 5173 --directory dist', port: 5173, reuseExistingServer: true },
});
