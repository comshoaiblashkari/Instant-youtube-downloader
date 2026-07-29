const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let hasYtDlp = false;
try {
  execSync('yt-dlp --version', { stdio: 'ignore' });
  hasYtDlp = true;
  console.log('✅ System Check: yt-dlp is ready.');
} catch (e) {
  console.error('⚠️ System Warning: yt-dlp binary not detected on PATH.');
}

function sanitizeFilename(str) {
  return (str || 'download').replace(/[/\\?%*:|"<>]/g, '_').trim();
}

function resolveRedirects(initialUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects === 0) return reject(new Error('Too many redirects'));
    
    const client = initialUrl.startsWith('https') ? https : http;
    client.get(initialUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let nextUrl = res.headers.location;
        if (!nextUrl.startsWith('http')) {
          const parsed = new URL(initialUrl);
          nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
        }
        return resolve(resolveRedirects(nextUrl, maxRedirects - 1));
      }
      resolve(initialUrl);
    }).on('error', reject);
  });
}

/**
 * Metadata Endpoint
 */
app.get('/api/info', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL parameter is required.' });

  if (targetUrl.includes('onedrive') || targetUrl.includes('1drv.ms') || targetUrl.match(/\.(mp4|m4a|mp3|webm)(\?.*)?$/i)) {
    return res.json({
      title: 'Direct Cloud / Media File',
      isDirect: true,
      url: targetUrl
    });
  }

  if (!hasYtDlp) {
    return res.status(500).json({ error: 'yt-dlp is not available on server.' });
  }

  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-call-home',
    '--geo-bypass',
    targetUrl
  ];

  const process = spawn('yt-dlp', args);
  let stdout = '';
  let stderr = '';

  process.stdout.on('data', chunk => { stdout += chunk; });
  process.stderr.on('data', chunk => { stderr += chunk; });

  process.on('close', code => {
    if (code !== 0) {
      console.error('[Info Failed]:', stderr);
      return res.status(500).json({ error: 'Failed to extract video info.' });
    }
    try {
      const data = JSON.parse(stdout);
      return res.json({
        title: data.title || 'Downloaded Media',
        uploader: data.uploader || 'Unknown',
        duration: data.duration,
        thumbnail: data.thumbnail,
        isDirect: false
      });
    } catch (e) {
      return res.status(500).json({ error: 'Error parsing metadata.' });
    }
  });
});

/**
 * Direct Stream Download Endpoint
 */
app.get('/api/download', async (req, res) => {
  const { url, format = 'mp4', quality = 'best', title } = req.query;
  if (!url) return res.status(400).send('URL is required');

  const cleanTitle = sanitizeFilename(title || 'media_download');
  const isAudioOnly = format === 'mp3';
  const extension = isAudioOnly ? 'mp3' : 'mp4';

  res.setHeader('Content-Disposition', `attachment; filename="${cleanTitle}.${extension}"`);
  res.setHeader('Content-Type', isAudioOnly ? 'audio/mpeg' : 'video/mp4');

  // Route 1: Direct File / OneDrive Stream
  if (url.includes('onedrive') || url.includes('1drv.ms') || url.match(/\.(mp4|m4a|mp3)(\?.*)?$/i)) {
    try {
      let directUrl = url;
      if (url.includes('onedrive.live.com')) {
        directUrl = url.replace('/redir?', '/download?').replace('/embed?', '/download?');
      }
      
      const finalUrl = await resolveRedirects(directUrl);
      const client = finalUrl.startsWith('https') ? https : http;

      client.get(finalUrl, (streamRes) => {
        streamRes.pipe(res);
      }).on('error', (err) => {
        console.error('[Direct Stream Error]:', err.message);
        if (!res.headersSent) res.status(500).send('Direct stream error');
      });
      return;
    } catch (e) {
      if (!res.headersSent) res.status(500).send('Link resolution failed');
      return;
    }
  }

  // Route 2: Video Services via yt-dlp
  if (!hasYtDlp) {
    return res.status(500).send('yt-dlp unavailable');
  }

  let formatSelector = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
  if (isAudioOnly) {
    formatSelector = 'bestaudio/best';
  } else if (quality !== 'best') {
    formatSelector = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}]/best`;
  }

  const args = [
    '-o', '-',
    '-f', formatSelector,
    '--no-part',
    '--no-buffer',
    '--geo-bypass',
    url
  ];

  const downloader = spawn('yt-dlp', args);
  downloader.stdout.pipe(res);

  downloader.stderr.on('data', (data) => {
    console.log(`[Stream Status]: ${data.toString().trim()}`);
  });

  req.on('close', () => {
    downloader.kill('SIGTERM');
  });
});

app.listen(PORT, () => {
  console.log(`⚡ Downloader Engine running on port ${PORT}`);
});