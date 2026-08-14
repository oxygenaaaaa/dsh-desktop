"use strict";

/**
 * dsh-desktop — Electron main process.
 *
 * M1: boots the DSH web backend as a child process (`dsh web --port 0`), waits
 *     for the URL line it prints, then opens a BrowserWindow pointed at it.
 * M2: injects a Codex-style CSS skin after every page load (no DSH source
 *     changes).
 * M3: system tray — closing the window hides to tray instead of quitting.
 * Packaged: the dsh bundle ships as resources/dsh (extraResources) and runs on
 *     Electron's own Node runtime (ELECTRON_RUN_AS_NODE), so end users need no
 *     separate Node install.
 */

const { app, BrowserWindow, nativeTheme, nativeImage, Tray, Menu, dialog } = require("electron");
const { spawn } = require("node:child_process");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const readline = require("node:readline");

// GUI apps must survive closed stdout/stderr pipes: when launched from a
// console/agent that detaches, a later console.log throws EPIPE and would
// otherwise crash the main process with an error dialog.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

/**
 * Path to the dsh CLI entry. Packaged: bundled at resources/dsh. Dev: the
 * locally installed @deepseek-ai/dsh package.
 */
const DSH_BIN = app.isPackaged
  ? resolve(process.resourcesPath, "dsh", "lib", "bin.js")
  : resolve("D:/DSH/node_modules/@deepseek-ai/dsh/lib/bin.js");
/** Regex matching the URL line `dsh web` prints once it is listening. */
const URL_RE = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/;
/** How long to wait for the backend to report its URL before giving up.
 *  Generous: first boot may build profile dependency links, and third-party
 *  antivirus can slow backend startup significantly. */
const BOOT_TIMEOUT_MS = 300_000;
/** Codex-style CSS skin, injected after the page loads (M2). */
const THEME_CSS_PATH = resolve(__dirname, "theme-codex.css");
/** When DSH_DESKTOP_SHOT=<path> is set: capture the rendered page to PNG and exit. */
const SHOT_PATH = process.env.DSH_DESKTOP_SHOT;
/** When DSH_DESKTOP_PROBE=<path> is set: dump a DOM layout map to JSON and exit. */
const PROBE_PATH = process.env.DSH_DESKTOP_PROBE;
/** When DSH_DESKTOP_E2E=<path> is set: drive a real UI conversation and report. */
const E2E_PATH = process.env.DSH_DESKTOP_E2E;
/** Packaged flag: bundle layout differs from dev checkout. */
const IS_PACKAGED = app.isPackaged;
/**
 * Data root for everything the app persists. Packaged: <install dir>/data, so
 * caches, Electron state and the DSH home all follow the path the user chose
 * at install time. Dev: inside the project dir.
 */
const DATA_ROOT = IS_PACKAGED
  ? resolve(dirname(process.execPath), "data")
  : resolve(__dirname, "..", ".userdata");
/** Dev-only override: keep Electron state inside the project dir. */
const DEV_USER_DATA = resolve(__dirname, "..", ".userdata");
/** Whale tray icon — user wants the black whale everywhere. Set to true to
 *  auto-swap white-on-dark / black-on-light for dark taskbars instead. */
const TRAY_AUTO_SWAP = false;
const TRAY_ICON = () => resolve(__dirname, "..", "assets", "tray-black-32.png");
const TRAY_ICON_SWAP = (light) =>
  resolve(__dirname, "..", "assets", `tray-${light ? "black" : "white"}-32.png`);
/** App icon (window / taskbar): black whale. */
const APP_ICON = resolve(__dirname, "..", "assets", "icon.png");

let backend = null;
let win = null;
let tray = null;
let quitting = false;

/** Append to <data>/app/boot.log — survives console detachment. */
function logBoot(msg) {
  try {
    const p = resolve(DATA_ROOT, "app", "boot.log");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `[${new Date().toISOString()}] ${msg}\n`, { flag: "a" });
  } catch {}
}

/** Spawn `dsh web --port 0` and resolve with its loopback URL. */
function startBackend() {
  return new Promise((resolveUrl, reject) => {
    // Run on Electron's own Node runtime (works dev and packaged; end users
    // need no separate Node install). DSH_HOME: explicit env wins; packaged
    // defaults to <install>/data/dsh-home; dev inherits the environment.
    // --expose-internals: the loader prefers a pure-JS internal-module path
    // over the node-addon-require-builtin native addon (which does not work
    // under Electron's Node); without it the HMR service refuses to boot.
    const dshHome = process.env.DSH_HOME || (IS_PACKAGED ? resolve(DATA_ROOT, "dsh-home") : undefined);
    console.log(`[dsh-desktop] spawning dsh web (DSH_HOME=${dshHome ?? "(inherited)"})`);
    logBoot(`spawn dsh web DSH_BIN=${DSH_BIN} DSH_HOME=${dshHome ?? "(inherited)"}`);
    backend = spawn(process.execPath, ["--expose-internals", DSH_BIN, "web", "--port", "0"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(dshHome ? { DSH_HOME: dshHome } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    logBoot(`backend pid=${backend.pid}`);

    const timer = setTimeout(() => {
      backend.kill();
      reject(new Error(`dsh web did not report a URL within ${BOOT_TIMEOUT_MS / 1000}s`));
    }, BOOT_TIMEOUT_MS);

    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };

    const rl = readline.createInterface({ input: backend.stdout });
    rl.on("line", (line) => {
      console.log(`[dsh-backend] ${line}`);
      logBoot(`backend stdout: ${line}`);
      const m = URL_RE.exec(line);
      if (m) settle(resolveUrl, m[1]);
    });

    backend.stderr.on("data", (chunk) => {
      process.stderr.write(`[dsh-backend:err] ${chunk}`);
      logBoot(`backend stderr: ${String(chunk).trim()}`);
    });

    // Backend died before reporting a URL — fail the boot.
    backend.on("exit", (code) => {
      logBoot(`backend exited code=${code}`);
      settle(reject, new Error(`dsh web exited before listening (code ${code})`));
    });
  });
}

function shutdown() {
  if (backend && backend.exitCode === null && !backend.killed) {
    console.log("[dsh-desktop] killing dsh backend");
    backend.kill();
  }
  backend = null;
}

// Screenshot mode skips the single-instance lock so we can run capture runs
// alongside (or instead of) the normal app.
const gotLock = SHOT_PATH || PROBE_PATH || E2E_PATH ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // All Electron-local state under the data root: packaged = <install>/data/app,
  // dev = project .userdata.
  app.setPath("userData", IS_PACKAGED ? resolve(DATA_ROOT, "app") : DEV_USER_DATA);

  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  /** Create the system tray (M3). Skipped in shot/probe runs. */
  function createTray() {
    if (SHOT_PATH || PROBE_PATH || E2E_PATH) return;
    const setTrayImage = () => {
      tray.setImage(
        nativeImage.createFromPath(TRAY_AUTO_SWAP ? TRAY_ICON_SWAP(nativeTheme.shouldUseDarkColors) : TRAY_ICON())
      );
    };
    tray = new Tray(nativeImage.createFromPath(TRAY_AUTO_SWAP ? TRAY_ICON_SWAP(nativeTheme.shouldUseDarkColors) : TRAY_ICON()));
    tray.setToolTip("DSH Desktop");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "打开 DSH Desktop", click: () => { if (win) { win.show(); win.focus(); } } },
        { type: "separator" },
        { label: "退出", click: () => { quitting = true; app.quit(); } },
      ])
    );
    tray.on("click", () => { if (win) { win.show(); win.focus(); } });
    nativeTheme.on("updated", setTrayImage);
  }

  /** Drive a real UI conversation (E2E): send a message, wait for the model's
   *  reply and the usage/stats line under the composer. Proof that the GUI is
   *  fully functional, not a shell. */
  async function runE2E() {
    const driver = `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const out = { steps: [], composerFound: false, sendBtnFound: false, sent: false, reply: null, stats: null, lastText: "", finishedAt: new Date().toISOString() };
      const btns = () => Array.from(document.querySelectorAll("button"));
      // Dismiss any onboarding/notice overlay.
      for (const b of btns()) {
        const t = (b.innerText || "").trim();
        if (t === "继续" || t === "知道了" || /开始使用|跳过/.test(t)) { b.click(); out.steps.push("dismissed overlay: " + t); await sleep(1500); break; }
      }
      const userMsg = "请只回复三个字：收到。";
      const ta = document.querySelector("textarea");
      out.composerFound = !!ta;
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter.call(ta, userMsg);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(500);
      }
      let sendBtn = null;
      for (const b of btns()) {
        const label = (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "");
        if (/发送|send|submit/i.test(label)) { sendBtn = b; break; }
      }
      if (!sendBtn) sendBtn = btns().find(b => b.querySelector("svg") && (b.innerText || "").trim() === "" && b.offsetParent !== null);
      out.sendBtnFound = !!sendBtn;
      // Wait for the send control to become enabled after typing.
      for (let i = 0; i < 8 && sendBtn && sendBtn.disabled; i++) await sleep(500);
      if (ta && sendBtn) { sendBtn.click(); out.sent = true; out.steps.push("clicked send"); }
      const statPatterns = [/轮\\s*[·•]\\s*\\d+\\s*步/, /LLM\\s+[\\d.]+[smh]/, /工具调用\\s+[\\d.]+[smh]/, /首\\s*token\\s*平均/, /tok\\/s/, /缓存命中\\s*\\d+%/, /输入\\s+[\\d.]+\\s*[MK]?tok/, /输出\\s+[\\d.]+\\s*[MK]?tok/];
      for (let i = 0; i < 45; i++) {
        await sleep(3000);
        const txt = document.body.innerText || "";
        out.lastText = txt.slice(-900);
        const ui = txt.indexOf(userMsg);
        if (out.reply === null && ui >= 0) {
          const after = txt.slice(ui + userMsg.length);
          if (after.includes("收到")) out.reply = after.slice(0, 400);
        }
        if (out.stats === null) {
          const found = statPatterns.map(p => txt.match(p)).filter(Boolean).map(m => m[0]);
          if (found.length >= 2) out.stats = found;
        }
        if (out.reply && out.stats) break;
        if (i === 44) out.steps.push("timeout waiting for reply/stats");
      }
      return out;
    })()`;
    const result = await win.webContents.executeJavaScript(driver);
    try {
      const dbg = win.webContents.debugger;
      dbg.attach("1.3");
      const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png" });
      dbg.detach();
      const pngPath = E2E_PATH.replace(/\.json$/, ".png");
      mkdirSync(dirname(pngPath), { recursive: true });
      writeFileSync(pngPath, Buffer.from(shot.data, "base64"));
      result.screenshot = pngPath;
    } catch {}
    return result;
  }

  app.whenReady().then(async () => {
    nativeTheme.themeSource = "dark";

    win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: "#18181b",
      title: "DSH Desktop",
      icon: APP_ICON,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: resolve(__dirname, "preload.js"),
      },
    });

    // M3: closing the window hides to tray (unless actually quitting).
    win.on("close", (event) => {
      if (!quitting && !SHOT_PATH && !PROBE_PATH && !E2E_PATH) {
        event.preventDefault();
        win.hide();
      }
    });

    win.on("closed", () => {
      win = null;
    });

    createTray();

    // M2: (re)inject the Codex skin on every navigation — the SPA may reload
    // the document after loadURL, which wipes insertCSS' style.
    const injectSkin = () => {
      try {
        const css = readFileSync(THEME_CSS_PATH, "utf8");
        win.webContents.insertCSS(css).catch(() => {});
      } catch (err) {
        console.error("[dsh-desktop] skin inject failed:", err);
      }
    };
    win.webContents.on("did-finish-load", injectSkin);

    try {
      const url = await startBackend();
      console.log(`[dsh-desktop] backend ready at ${url}`);
      logBoot(`backend ready at ${url}`);
      if (win) {
        await win.loadURL(url);
        logBoot("window loadURL resolved");
        // M2: inject the Codex-style skin once the DSH UI is mounted.
        injectSkin();
        if (SHOT_PATH || PROBE_PATH || E2E_PATH) {
          win.webContents.setBackgroundThrottling(false);
          setTimeout(async () => {
            try {
              if (PROBE_PATH) {
                const probe = await win.webContents.executeJavaScript(`(() => {
                  const out = [];
                  const walk = (el, depth) => {
                    if (depth > 7) return;
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 20 && rect.height > 8) {
                      const cs = getComputedStyle(el);
                      out.push({
                        tag: el.tagName,
                        cls: (typeof el.className === "string" ? el.className : "").slice(0, 100),
                        text: (el.innerText || "").replace(/\\s+/g, " ").slice(0, 50),
                        x: Math.round(rect.x), y: Math.round(rect.y),
                        w: Math.round(rect.width), h: Math.round(rect.height),
                        bg: cs.backgroundColor, display: cs.display,
                      });
                    }
                    for (const c of el.children) walk(c, depth + 1);
                  };
                  walk(document.body, 0);
                  return out.slice(0, 150);
                })()`);
                mkdirSync(dirname(PROBE_PATH), { recursive: true });
                writeFileSync(PROBE_PATH, JSON.stringify(probe, null, 1));
                console.log(`[dsh-desktop] probe saved to ${PROBE_PATH}`);
              }
              if (SHOT_PATH) {
              let png = null;
              // CDP Page.captureScreenshot works without a display surface
              // (headless-ish sessions); fall back to capturePage.
              try {
                const dbg = win.webContents.debugger;
                dbg.attach("1.3");
                const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png" });
                dbg.detach();
                png = Buffer.from(shot.data, "base64");
              } catch {
                const image = await win.webContents.capturePage();
                png = image.toPNG();
              }
              mkdirSync(dirname(SHOT_PATH), { recursive: true });
              writeFileSync(SHOT_PATH, png);
              console.log(`[dsh-desktop] screenshot saved to ${SHOT_PATH}`);
              logBoot(`screenshot saved ${SHOT_PATH}`);
              // Sidecar DOM report for programmatic verification (no image model needed).
              try {
                const report = await win.webContents.executeJavaScript(`(() => {
                  const b = document.body;
                  const cs = getComputedStyle(b);
                  const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"]');
                  const styles = Array.from(document.querySelectorAll("style"));
                  const sheets = Array.from(document.styleSheets);
                  return {
                    darkTheme: b.getAttribute("data-ds-dark-theme"),
                    bodyBg: cs.backgroundColor,
                    bodyColor: cs.color,
                    title: document.title,
                    readyState: document.readyState,
                    href: location.href,
                    text: (b.innerText || "").replace(/\\s+/g, " ").slice(0, 600),
                    sidebarFound: !!sidebar,
                    skinInjected: document.documentElement.innerHTML.includes("zinc ramp"),
                    styleTagCount: styles.length,
                    lastStylePrefix: styles.length ? styles[styles.length - 1].textContent.slice(0, 120) : null,
                    sheetCount: sheets.length,
                    lastSheetHref: sheets.length ? sheets[sheets.length - 1].href : null,
                    token950: cs.getPropertyValue("--dsw-static-neutral-bluish-950"),
                    aliasBgBase: cs.getPropertyValue("--dsw-alias-bg-base"),
                  };
                })()`);
                writeFileSync(SHOT_PATH.replace(/\.png$/, ".report.json"), JSON.stringify(report, null, 2));
                console.log("[dsh-desktop] dom report saved");
              } catch (err) {
                console.error("[dsh-desktop] dom report failed:", err);
              }
              } // end if (SHOT_PATH)
              if (E2E_PATH) {
                const e2e = await runE2E();
                mkdirSync(dirname(E2E_PATH), { recursive: true });
                writeFileSync(E2E_PATH, JSON.stringify(e2e, null, 2));
                console.log(`[dsh-desktop] e2e report saved to ${E2E_PATH}`);
                logBoot(`e2e report saved ${E2E_PATH}`);
              }
            } catch (err) {
              console.error("[dsh-desktop] screenshot failed:", err);
            }
            app.quit();
          }, 10_000);
        } else {
          console.log("[dsh-desktop] window loaded");
        }
      }
    } catch (err) {
      console.error("[dsh-desktop] boot failed:", err);
      logBoot(`boot failed: ${err.message}`);
      if (!SHOT_PATH && !PROBE_PATH && !E2E_PATH) {
        dialog.showErrorBox("DSH Desktop", String(err.message || err));
      }
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    // Normal mode keeps running in the tray; shot/probe runs and explicit
    // quits terminate.
    if (quitting || SHOT_PATH || PROBE_PATH || E2E_PATH) app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    shutdown();
  });
  process.on("exit", shutdown);
}
