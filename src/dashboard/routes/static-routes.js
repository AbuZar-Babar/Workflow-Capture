/**
 * Static Asset Routes
 *
 * Encapsulates static asset serving, MIME types, HTTP 206 Partial Content
 * range requests for videos, download attachments, and HTTP caching headers.
 */

const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime'
};

class StaticRoutes {
  constructor(publicDir = path.join(__dirname, '../public')) {
    this.publicDir = publicDir;
    this.resolveFilePath = this.resolveFilePath.bind(this);
    this.handleStatic = this.handleStatic.bind(this);
  }

  /**
   * Resolve an HTTP request pathname to an absolute disk path.
   *
   * @param {string} pathname
   * @returns {string} Absolute file path
   */
  resolveFilePath(pathname) {
    let filePath;
    if (pathname.startsWith('/Run/')) {
      const runFile = pathname.replace('/Run/', '');
      filePath = path.join(process.cwd(), 'Run', runFile);
    } else if (pathname.startsWith('/downloads/')) {
      const downloadFile = pathname.replace('/downloads/', '');
      filePath = path.join(process.cwd(), 'downloads', downloadFile);
    } else if (pathname.startsWith('/portal/')) {
      const portalFile = pathname.replace('/portal/', '');
      filePath = path.join(process.cwd(), 'test', portalFile);
    } else if (pathname.startsWith('/test/')) {
      const testFile = pathname.replace('/test/', '');
      filePath = path.join(process.cwd(), 'test', testFile);
    } else if (pathname === '/' || pathname === '/landing' || pathname === '/landing.html') {
      filePath = path.join(this.publicDir, 'landing.html');
    } else if (pathname === '/app' || pathname === '/dashboard') {
      filePath = path.join(this.publicDir, 'index.html');
    } else {
      filePath = path.join(this.publicDir, pathname);
    }
    return filePath;
  }

  /**
   * Serve a static asset or return 404 Not Found.
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {string} pathname
   * @param {URL} urlObj
   * @returns {boolean} True if file found and response initiated, false if 404
   */
  handleStatic(req, res, pathname, urlObj) {
    const filePath = this.resolveFilePath(pathname);
    const extname = String(path.extname(filePath)).toLowerCase();

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const stat = fs.statSync(filePath);
      const totalSize = stat.size;
      const contentType = MIME_TYPES[extname] || 'application/octet-stream';

      // Support HTTP 206 Range Requests for video files
      const range = req.headers.range;
      if (range && (extname === '.mp4' || extname === '.webm' || extname === '.ogg' || extname === '.mov')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        fileStream.pipe(res);
        return true;
      }

      const headers = {
        'Content-Type': contentType,
        'Content-Length': totalSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': extname === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
        'Pragma': 'no-cache',
        'Expires': '0'
      };
      if (urlObj && urlObj.searchParams && urlObj.searchParams.get('download') === '1') {
        headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
      }
      res.writeHead(200, headers);
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      return true;
    }

    // Fallback: 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return false;
  }
}

const staticRoutes = new StaticRoutes();

module.exports = staticRoutes;
module.exports.StaticRoutes = StaticRoutes;
module.exports.staticRoutes = staticRoutes;
module.exports.MIME_TYPES = MIME_TYPES;
