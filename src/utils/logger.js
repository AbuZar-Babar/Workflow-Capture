/**
 * Formatted Terminal Logger for Recorder and Replay Engine
 */

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const logger = {
  info(msg, meta) {
    console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`, meta ? `${colors.dim}${JSON.stringify(meta)}${colors.reset}` : '');
  },

  success(msg, meta) {
    console.log(`${colors.green}${colors.bold}[SUCCESS]${colors.reset} ${msg}`, meta ? `${colors.dim}${JSON.stringify(meta)}${colors.reset}` : '');
  },

  warn(msg, meta) {
    console.warn(`${colors.yellow}[WARN]${colors.reset} ${msg}`, meta ? `${colors.dim}${JSON.stringify(meta)}${colors.reset}` : '');
  },

  error(msg, err) {
    console.error(`${colors.red}${colors.bold}[ERROR]${colors.reset} ${msg}`);
    if (err) {
      if (err.details) {
        console.error(`${colors.red}Details:${colors.reset}`, JSON.stringify(err.details, null, 2));
      }
      if (err.stack) {
        console.error(`${colors.gray}${err.stack}${colors.reset}`);
      } else {
        console.error(err);
      }
    }
  },

  action(index, type, desc, detail) {
    const paddedIndex = String(index).padStart(3, ' ');
    console.log(
      `${colors.blue}#${paddedIndex}${colors.reset} ` +
      `${colors.bold}[${type.padEnd(12, ' ')}]${colors.reset} ` +
      `${desc} ` +
      (detail ? `${colors.dim}(${detail})${colors.reset}` : '')
    );
  },

  header(title) {
    console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}\n`);
  },

  divider() {
    console.log(`${colors.gray}------------------------------------------------------------${colors.reset}`);
  }
};

module.exports = logger;
