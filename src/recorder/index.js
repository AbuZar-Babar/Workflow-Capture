#!/usr/bin/env node

/**
 * Recorder CLI Entry Point
 * 
 * Usage:
 *   npm run record
 *   npm run record -- --name citymart-search
 *   npm run record -- --port 9222 --name test-run
 */

const readline = require('readline');
const RecorderBridge = require('./recorder-bridge');
const logger = require('../utils/logger');

// Simple argument parser
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    name: null,
    port: '9222'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      options.name = args[i + 1];
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      options.port = args[i + 1];
      i++;
    }
  }

  if (!options.name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    options.name = `recording-${timestamp}`;
  }

  return options;
}

async function main() {
  const options = parseArgs();
  const browserURL = `http://localhost:${options.port}`;

  const recorder = new RecorderBridge({
    name: options.name,
    browserURL
  });

  try {
    await recorder.start();
  } catch (err) {
    logger.error('Failed to start recorder:', err);
    process.exit(1);
  }

  // Setup terminal listener to gracefully stop on Enter or SIGINT
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let isStopping = false;
  async function handleStop() {
    if (isStopping) return;
    isStopping = true;
    rl.close();
    try {
      await recorder.stop();
      process.exit(0);
    } catch (err) {
      logger.error('Error while stopping recorder:', err);
      process.exit(1);
    }
  }

  rl.on('line', () => {
    handleStop();
  });

  process.on('SIGINT', () => {
    console.log('\n[Workflow Capture] Received SIGINT...');
    handleStop();
  });
}

main().catch(err => {
  logger.error('Unhandled fatal error in recorder CLI:', err);
  process.exit(1);
});
