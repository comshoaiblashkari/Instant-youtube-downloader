const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

const cookiesPath = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);

if (hasCookies) {
  console.log('✅ Found cookies.txt - YouTube cloud IP bypass enabled!');
} else {
  console.warn('⚠️ Warning: cookies.txt not found. YouTube may block datacenter requests.');
}

// 1. ROOT ROUTE
app.get('/', (req, res) => {
  const rootIndex = path.join(__dirname, 'index.html');
  const publicIndex = path.join(__dirname, 'public', 'index.html');

  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  } else if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Universal Downloader Engine</title>
        <style>
          body { background: #0f0f12; color: #fff; font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .card { background: #18181f; padding: 40px; border-radius: 16px; text-align: center; border: 1px solid rgba(255,255,255,0.1); max-width: 480px; }
          h1 { color: #3ea6ff; font-size: 24px; margin-bottom: 12px; }
          p { color: #aaa; font-size: 14px; line-height: 1.6; }
          .badge { background: #2ba640; color: #fff; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 12px; display: inline-block; margin-bottom: 15px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">● Server Online</div>
          <h1>⚡ Downloader Engine Active</h1>
          <p>Status: ${hasCookies ? 'Authenticated with cookies.txt (Bypass active)' : 'Running (Add cookies.txt to avoid IP blocks)'}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// 2. HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({ status: 'online', cookiesLoaded: hasCookies, timestamp: new Date() });
});

// 3. GET VIDEO INFO
app.get('/api/info', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing video URL parameter (?url=...)' });
  }

  const args = [
    '--dump-json',
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,ios,web'
  ];

  if (hasCookies) {
    args.push('--cookies', cookiesPath);
  }

  args.push(videoUrl);

  const ytdlp = spawn('yt-dlp', args);
  let outputData = '';
  let errorData = '';

  ytdlp.stdout.on('data', (data) => { outputData += data.toString(); });
  ytdlp.stderr.on('data', (data) => { errorData += data.toString(); });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp info error:', errorData);
      return res.status(500).json({ 
        error: 'Failed to fetch video information', 
        details: errorData || 'YouTube blocked request. Please upload cookies.txt.' 
      });
    }
    try {
      const info = JSON.parse(outputData);
      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        formats: info.formats ? info.formats.map(f => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || `${f.width}x${f.height}`,
          quality: f.format_note,
          filesize: f.filesize || f.filesize_approx
        })) : []
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to parse video json' });
    }
  });
});

// 4. DOWNLOAD VIDEO / AUDIO
app.get('/api/download', (req, res) => {
  const videoUrl = req.query.url;
  const format = req.query.format || 'best';
  const type = req.query.type || 'video';

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing video URL parameter' });
  }

  let args = [
    '-o', '-',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,ios,web'
  ];

  if (hasCookies) {
    args.push('--cookies', cookiesPath);
  }

  if (type === 'audio') {
    args.push('-x', '--audio-format', 'mp3', videoUrl);
    res.header('Content-Type', 'audio/mpeg');
    res.header('Content-Disposition', 'attachment; filename="audio.mp3"');
  } else {
    args.push('-f', format === 'best' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' : format, videoUrl);
    res.header('Content-Type', 'video/mp4');
    res.header('Content-Disposition', 'attachment; filename="video.mp4"');
  }

  const ytdlp = spawn('yt-dlp', args);
  ytdlp.stdout.pipe(res);

  ytdlp.stderr.on('data', (data) => console.error(`yt-dlp stderr: ${data}`));
  ytdlp.on('close', (code) => { if (code !== 0) console.error(`Exit code: ${code}`); });

  req.on('close', () => ytdlp.kill());
});

app.listen(PORT, () => {
  console.log(`⚡ Downloader Engine running on port ${PORT}`);
});
