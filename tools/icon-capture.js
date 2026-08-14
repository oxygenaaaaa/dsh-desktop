"use strict";

/**
 * Icon capture tool — rasterizes the official DeepSeek whale SVG into a PNG
 * using Chromium (via Electron), so no external rasterizer is needed.
 *
 * Usage:
 *   electron tools/icon-capture.js <out.png> <size> <filter>
 *     filter: "none" (black whale) | "invert(1)" (white whale)
 */

const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const FAVICON = resolve(
  "D:/DSH/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg"
);
const OUT = resolve(process.argv[2] || "assets/icon.png");
const SIZE = Number(process.argv[3] || 256);
const FILTER = process.argv[4] || "none";

app.whenReady().then(async () => {
  const svg = readFileSync(FAVICON, "utf8");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; overflow: hidden; background: transparent; color-scheme: light; }
    svg { width: ${SIZE}px; height: ${SIZE}px; display: block; filter: ${FILTER}; }
  </style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));

  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  const shot = await dbg.sendCommand("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  dbg.detach();

  writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log(`saved ${OUT} (${SIZE}x${SIZE}, filter=${FILTER})`);
  app.quit();
});
