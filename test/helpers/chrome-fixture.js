/**
 * Workflow Capture — Isolated Chrome Test Fixture
 *
 * Provides reliable, isolated headless Chrome instances for browser-backed tests:
 * 1. Automatic Chrome detection via configuration (CHROME_PATH, CHROME_BIN, etc.)
 *    and documented platform lookup (Windows, macOS, Linux).
 * 2. Dynamic, collision-free debugging port allocation per process.
 * 3. Unique temporary user-data-dir profile per test run.
 * 4. Deterministic Chrome process termination and awaited exit before profile removal,
 *    preventing file locks and orphan processes on Windows and Unix.
 * 5. Startup and shutdown timeouts with detailed diagnostics on failure.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const http = require('http');
const { spawn, execSync } = require('child_process');
const logger = require('../../src/utils/logger');

/**
 * Locate Chrome / Chromium executable path for current environment.
 * Checks configuration environment variables first, then documented platform paths.
 *
 * @param {string} [preferredPath] - Explicit path override
 * @returns {string} Absolute path to executable
 * @throws {Error} Actionable error if executable cannot be found
 */
function getChromeExecutablePath(preferredPath = null) {
  // If an explicit path was passed, validate it directly
  if (preferredPath) {
    if (fs.existsSync(preferredPath)) {
      return path.resolve(preferredPath);
    }
    throw new Error(
      `Specified Chrome executable path does not exist: "${preferredPath}".\n` +
      `Please provide a valid path or remove the setting to allow auto-detection.`
    );
  }

  // 1. Check environment variables
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) {
      return path.resolve(process.env.CHROME_PATH);
    }
    throw new Error(
      `CHROME_PATH environment variable is set to "${process.env.CHROME_PATH}", but the file does not exist.\n` +
      `Please update CHROME_PATH to point to a valid Chrome executable.`
    );
  }

  const envCandidates = [
    process.env.CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.GOOGLE_CHROME_BIN
  ].filter(Boolean);

  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  // 2. Documented platform lookups
  const platform = process.platform;
  const platformCandidates = [];

  if (platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    const programW6432 = process.env.PROGRAMW6432 || '';

    platformCandidates.push(
      path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(programW6432, 'Google\\Chrome\\Application\\chrome.exe'),
      // Fallback to Microsoft Edge (Chromium-based) if Chrome is not installed
      path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else if (platform === 'darwin') {
    platformCandidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    // Linux and others
    platformCandidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    );
  }

  for (const candidate of platformCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  // 3. Fallback: check system PATH via command lookup
  try {
    const lookupCmd = platform === 'win32' ? 'where.exe chrome' : 'which google-chrome || which chromium';
    const resolved = execSync(lookupCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    if (resolved && fs.existsSync(resolved)) {
      return path.resolve(resolved);
    }
  } catch {}

  const checkedPaths = [
    ...envCandidates.map(c => `[ENV] ${c}`),
    ...platformCandidates.map(c => `[PLATFORM] ${c}`)
  ].join('\n  ');

  throw new Error(
    `Google Chrome executable could not be found on this system.\n` +
    `Checked locations:\n  ${checkedPaths}\n\n` +
    `Please configure the executable path via the CHROME_PATH or CHROME_BIN environment variable, e.g.:\n` +
    (platform === 'win32'
      ? `  set CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\n`
      : `  export CHROME_PATH="/usr/bin/google-chrome"\n`)
  );
}

/**
 * Find an open, unallocated TCP port on the loopback interface
 *
 * @param {number} [preferredPort=0] - If > 0, attempts to bind preferredPort
 * @returns {Promise<number>} Available port
 */
async function getAvailablePort(preferredPort = 0) {
  if (preferredPort > 0) {
    const isFree = await new Promise(resolve => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(preferredPort, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
    if (isFree) return preferredPort;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Verify whether a process with the given PID is currently active.
 *
 * @param {number} pid - Process ID
 * @returns {boolean} true if alive, false otherwise
 */
function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // EPERM means process exists but we lack permission to signal
  }
}

/**
 * Check if the Chrome CDP endpoint is responding
 *
 * @param {number} port - CDP port
 * @param {number} [timeoutMs=500] - Request timeout
 * @returns {Promise<boolean>}
 */
async function isCDPResponding(port, timeoutMs = 500) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: timeoutMs }, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Await process exit up to timeoutMs.
 *
 * @param {import('child_process').ChildProcess} proc - Process handle
 * @param {number} [timeoutMs=5000] - Max wait time in ms
 * @returns {Promise<boolean>} true if process exited, false if timed out
 */
async function waitForProcessExit(proc, timeoutMs = 5000) {
  if (!proc || !proc.pid) return true;
  if (proc.exitCode !== null || !isProcessAlive(proc.pid)) return true;

  const start = Date.now();
  return new Promise(resolve => {
    let timer = null;

    const onExit = () => {
      if (timer) clearInterval(timer);
      resolve(true);
    };

    proc.once('exit', onExit);
    proc.once('close', onExit);

    timer = setInterval(() => {
      if (!isProcessAlive(proc.pid) || proc.exitCode !== null) {
        clearInterval(timer);
        proc.removeListener('exit', onExit);
        proc.removeListener('close', onExit);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        proc.removeListener('exit', onExit);
        proc.removeListener('close', onExit);
        resolve(false);
      }
    }, 50);
  });
}

/**
 * Reliably terminate Chrome process and all child/sub-processes in its process tree.
 * On Windows, utilizes taskkill /F /T /PID to prevent orphaned renderers or GPU processes.
 * On Unix/macOS, sends SIGTERM followed by SIGKILL.
 *
 * @param {import('child_process').ChildProcess} proc - Child process handle
 * @param {number} [timeoutMs=8000] - Shutdown timeout
 * @returns {Promise<{ exited: boolean, diagnostics: string|null }>}
 */
async function terminateChromeProcess(proc, timeoutMs = 8000) {
  if (!proc || !proc.pid) {
    return { exited: true, diagnostics: null };
  }

  const pid = proc.pid;
  if (!isProcessAlive(pid) || proc.exitCode !== null) {
    return { exited: true, diagnostics: null };
  }

  const isWindows = process.platform === 'win32';

  if (isWindows) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } catch {}
    try {
      proc.kill();
    } catch {}
  } else {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }

  let exited = await waitForProcessExit(proc, Math.min(timeoutMs, 4000));

  if (!exited && !isWindows) {
    // Escalate to SIGKILL on Unix
    try {
      proc.kill('SIGKILL');
    } catch {}
    exited = await waitForProcessExit(proc, 3000);
  } else if (!exited && isWindows) {
    // Retry taskkill
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } catch {}
    exited = await waitForProcessExit(proc, 2000);
  }

  if (!exited) {
    const diag = `Chrome process (PID: ${pid}) failed to exit within ${timeoutMs}ms shutdown timeout. Process remains active in OS table.`;
    return { exited: false, diagnostics: diag };
  }

  return { exited: true, diagnostics: null };
}

/**
 * Remove a temporary profile directory with retries.
 * Ensures all file handles and locks are released before completion.
 *
 * @param {string} profileDir - Path to profile directory
 * @param {number} [maxRetries=15] - Maximum retry attempts
 * @param {number} [retryDelayMs=200] - Delay between retries in ms
 * @returns {Promise<void>}
 */
async function removeProfileDirectory(profileDir, maxRetries = 15, retryDelayMs = 200) {
  if (!profileDir || !fs.existsSync(profileDir)) return;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
      if (!fs.existsSync(profileDir)) return;
    } catch (err) {
      if (attempt === maxRetries) {
        let remaining = [];
        try {
          remaining = fs.readdirSync(profileDir);
        } catch {}
        throw new Error(
          `Profile cleanup failed for directory "${profileDir}" after ${maxRetries} attempts.\n` +
          `Remaining items: [${remaining.join(', ')}]\n` +
          `Underlying error: ${err.message}`
        );
      }
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }
}

/**
 * Creates an isolated Chrome fixture for test execution.
 *
 * @param {Object} [options]
 * @param {string} [options.chromePath] - Explicit path to Chrome binary
 * @param {number} [options.port] - Preferred port (defaults to available port)
 * @param {string} [options.prefix='chrome-test'] - Prefix for temp profile dir
 * @param {string} [options.initialUrl='about:blank'] - Initial navigation URL
 * @param {boolean} [options.headless=true] - Run in headless mode
 * @param {string[]} [options.additionalArgs=[]] - Additional CLI arguments
 * @param {number} [options.startupTimeoutMs=15000] - Timeout for CDP port ready
 * @param {number} [options.shutdownTimeoutMs=8000] - Timeout for process exit
 * @returns {Promise<ChromeFixture>}
 */
async function createChromeFixture(options = {}) {
  const startupTimeoutMs = options.startupTimeoutMs || 15000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs || 8000;
  const prefix = options.prefix || 'chrome-test';
  const initialUrl = options.initialUrl || 'about:blank';
  const headless = options.headless !== false;

  // 1. Resolve Chrome binary
  const chromePath = getChromeExecutablePath(options.chromePath);

  // 2. Allocate collision-free port
  const port = await getAvailablePort(options.port || (process.env.CHROME_DEBUG_PORT ? parseInt(process.env.CHROME_DEBUG_PORT, 10) : 0));
  const browserURL = `http://127.0.0.1:${port}`;

  // 3. Create unique temporary profile directory
  const runHash = crypto.randomBytes(4).toString('hex');
  const profileDirName = `${prefix}-${process.pid}-${Date.now()}-${runHash}`;
  const profileDir = path.join(os.tmpdir(), profileDirName);
  fs.mkdirSync(profileDir, { recursive: true });

  logger.info(`[ChromeFixture] Spawning isolated Chrome on port ${port} (PID: pending, Profile: ${profileDir})`);

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    headless ? '--headless=new' : '--no-headless',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-automation',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-search-engine-choice-screen',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-features=Translate,AcceptCHFrame,MediaRouter,OptimizationHints,ProcessPerSiteUpToMainFrameThreshold,IsolateSandboxedIframes',
    ...(options.additionalArgs || []),
    initialUrl
  ];

  let chromeProc = null;
  let stderrBuffer = '';
  let stdoutBuffer = '';
  let processExitedEarly = false;
  let earlyExitCode = null;
  let earlyExitSignal = null;
  let spawnError = null;

  try {
    chromeProc = spawn(chromePath, chromeArgs, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (spawnErr) {
    // Clean up profile immediately on synchronous spawn failure
    try { await removeProfileDirectory(profileDir); } catch {}
    throw new Error(
      `Failed to spawn Chrome process at "${chromePath}" (Profile: "${profileDir}"): ${spawnErr.message}\n` +
      `Check file permissions and ensure the path is executable.`
    );
  }

  // Handle asynchronous spawn errors emitted by ChildProcess
  const onSpawnError = (err) => {
    spawnError = err;
  };
  chromeProc.once('error', onSpawnError);

  if (chromeProc.stdout) {
    chromeProc.stdout.on('data', chunk => {
      stdoutBuffer = (stdoutBuffer + chunk.toString()).slice(-2000);
    });
  }

  if (chromeProc.stderr) {
    chromeProc.stderr.on('data', chunk => {
      stderrBuffer = (stderrBuffer + chunk.toString()).slice(-2000);
    });
  }

  const exitListener = (code, signal) => {
    processExitedEarly = true;
    earlyExitCode = code;
    earlyExitSignal = signal;
  };
  chromeProc.once('exit', exitListener);

  // 4. Wait for CDP endpoint readiness with startup timeout
  const startWait = Date.now();
  let isReady = false;

  while (Date.now() - startWait < startupTimeoutMs) {
    if (spawnError || processExitedEarly) {
      break;
    }
    if (await isCDPResponding(port, 200)) {
      isReady = true;
      break;
    }
    await new Promise(r => setTimeout(r, 150));
  }

  chromeProc.removeListener('exit', exitListener);

  if (!isReady) {
    // Chrome failed to start: terminate process if any, await exit, clean profile, throw actionable error
    const pid = chromeProc.pid;
    const { exited: startupExited, diagnostics: startupDiag } = await terminateChromeProcess(chromeProc, shutdownTimeoutMs);
    if (startupExited) {
      try {
        await removeProfileDirectory(profileDir);
      } catch (cleanupErr) {
        logger.warn(`[ChromeFixture] Profile cleanup on startup failure failed: ${cleanupErr.message}`);
      }
    } else {
      logger.error(
        `[ChromeFixture] Chrome process (PID: ${pid}) did not exit after startup failure.\n` +
        `Profile directory preserved at: "${profileDir}" to avoid racing a running process.\n` +
        `Diagnostics: ${startupDiag}`
      );
    }

    if (spawnError) {
      throw new Error(
        `Chrome process failed to spawn on port ${port} (Profile: "${profileDir}").\n` +
        `Executable: "${chromePath}"\n` +
        `Spawn error: ${spawnError.message} (code: ${spawnError.code || 'unknown'})`
      );
    }

    const diagReason = processExitedEarly
      ? `Process exited prematurely with exitCode=${earlyExitCode}, signal=${earlyExitSignal}.`
      : `Timed out after ${startupTimeoutMs}ms waiting for CDP port ${port} to respond.`;

    throw new Error(
      `Chrome startup failed on port ${port} (PID: ${pid}).\n` +
      `Reason: ${diagReason}\n` +
      `Executable: "${chromePath}"\n` +
      `Profile: "${profileDir}"\n` +
      (stderrBuffer.trim() ? `Stderr output:\n${stderrBuffer.trim()}` : `Stdout output:\n${stdoutBuffer.trim() || '(none)'}`)
    );
  }

  // Once started, replace the one-time spawn error handler with a general logger
  chromeProc.removeListener('error', onSpawnError);
  chromeProc.on('error', (err) => {
    logger.warn(`[ChromeFixture] Chrome process (PID: ${chromeProc.pid}) emitted error: ${err.message}`);
  });

  logger.success(`[ChromeFixture] Chrome running on port ${port} (PID: ${chromeProc.pid})`);

  let isCleanedUp = false;

  const fixture = {
    port,
    browserURL,
    profileDir,
    chromePath,
    process: chromeProc,
    pid: chromeProc.pid,

    /**
     * Terminate Chrome, await process exit, and clean temporary profile.
     * Idempotent and safe to invoke on success, assertion failure, or error.
     *
     * Note: Does NOT remove the profile unless process termination is verified,
     * preventing cleanup races against live Chrome processes.
     */
    async cleanup() {
      if (isCleanedUp) return;
      isCleanedUp = true;

      // Deregister signal handlers once cleanup runs
      process.removeListener('SIGINT', sigHandler);
      process.removeListener('SIGTERM', sigHandler);

      const targetProc = this.process || chromeProc;
      logger.info(`[ChromeFixture] Cleaning up fixture (PID: ${targetProc.pid}, Port: ${port}, Profile: ${profileDir})...`);

      // 1. Terminate Chrome process & await exit
      const { exited, diagnostics } = await terminateChromeProcess(targetProc, shutdownTimeoutMs);
      if (!exited || (targetProc.pid && isProcessAlive(targetProc.pid))) {
        const errorMsg =
          `Cannot remove temporary profile because Chrome process (PID: ${targetProc.pid}) did not exit within ${shutdownTimeoutMs}ms shutdown timeout.\n` +
          `Profile directory preserved at: "${profileDir}" to avoid racing a running process.\n` +
          `Diagnostics: ${diagnostics || 'Process is still active in the OS process table.'}`;
        logger.error(`[ChromeFixture] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // 2. Clean temporary profile directory only after exit is confirmed
      try {
        await removeProfileDirectory(profileDir);
        logger.info(`[ChromeFixture] Profile directory cleaned successfully: ${profileDir}`);
      } catch (profileErr) {
        logger.error(`[ChromeFixture] Profile cleanup failed: ${profileErr.message}`);
        throw profileErr;
      }
    }
  };

  /**
   * Signal handlers for graceful cleanup on manual cancellation (SIGINT/SIGTERM).
   * Note: Node does not execute asynchronous tasks in synchronous process 'exit' hooks,
   * so actual test lifecycle cleanup must be performed in try/finally blocks.
   */
  const sigHandler = async (signal) => {
    try {
      await fixture.cleanup();
    } catch {}
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', sigHandler);
  process.once('SIGTERM', sigHandler);

  return fixture;
}

module.exports = {
  createChromeFixture,
  getChromeExecutablePath,
  getAvailablePort,
  isProcessAlive,
  isCDPResponding,
  waitForProcessExit,
  terminateChromeProcess,
  removeProfileDirectory
};
