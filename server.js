const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from root and public folders
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// 1. ROOT ROUTE (Serves UI or Status Page)
app.get('/', (req, res) => {
  const rootIndex = path.join(__dirname, 'index.html');
  const publicIndex = path.join(__dirname, 'public', 'index.html');

  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  } else if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  } else {
    // Fallback UI status page if index.html isn't present
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Universal Downloader Engine</title>
        <style>
          body { background: #0f0f12; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .card { background: #18181f; padding: 40px; border-radius: 16px; text-align: center; border: 1px solid rgba(255,255,255,0.1); max-width: 480px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          h1 { color: #3ea6ff; font-size: 24px; margin-bottom: 12px; }
          p { color: #aaa; font-size: 14px; line-height: 1.6; margin-bottom: 20px; }
          .badge { background: #2ba640; color: #fff; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 12px; display: inline-block; margin-bottom: 15px; text-transform: uppercase; letter-spacing: 1px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">● Server Online 24/7</div>
          <h1>⚡ Downloader Server Active</h1>
          <p>Your Docker backend is running smoothly on Render with <strong>yt-dlp</strong> and <strong>ffmpeg</strong> ready!</p>
          <p>Your Chrome Extension and Web API are connected and ready to process video downloads.</p>
        </div>
      </body>
      </html>
    `);
  }
});

// 2. HEALTH CHECK ENDPOINT
app.get('/health', (req, res) => {
  res.json({ status: 'online', service: 'yt-dlp downloader engine', timestamp: new Date() });
});

// 3. GET VIDEO INFO ENDPOINT (With YouTube Cloud IP Bypass)
app.get('/api/info', (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing video URL parameter (?url=...)' });
  }

  // Force yt-dlp to use Android/web client APIs to bypass cloud server IP blocks
  const ytdlp = spawn('yt-dlp', [
    '--dump-json',
    '--no-warnings',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web',
    videoUrl
  ]);

  let outputData = '';
  let errorData = '';

  ytdlp.stdout.on('data', (data) => { outputData += data.toString(); });
  ytdlp.stderr.on('data', (data) => { errorData += data.toString(); });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp info error:', errorData);
      return res.status(500).json({ 
        error: 'Failed to fetch video information', 
        details: errorData || 'YouTube blocked the request or URL is invalid.' 
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
      res.status(500).json({ error: 'Failed to parse video information' });
    }
  });
});

// 4. DOWNLOAD VIDEO / AUDIO ENDPOINT (With YouTube Cloud IP Bypass)
app.get('/api/download', (req, res) => {
  const videoUrl = req.query.url;
  const format = req.query.format || 'best';
  const type = req.query.type || 'video'; // 'video' or 'audio'

  if (!videoUrl) {
    return res.status(400).json({ error: 'Missing video URL parameter' });
  }

  let args = [
    '-o', '-',
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=android,web'
  ];

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

  ytdlp.stderr.on('data', (data) => {
    console.error(`yt-dlp download stderr: ${data}`);
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error(`yt-dlp download process exited with code ${code}`);
    }
  });

  req.on('close', () => {
    ytdlp.kill();
  });
});

// START SERVER AND PERFORM SYSTEM CHECK
app.listen(PORT, () => {
  console.log(`⚡ Downloader Engine running on port ${PORT}`);
  try {
    const ytdlpVersion = execSync('yt-dlp --version').toString().trim();
    console.log(`✅ System Check: yt-dlp is ready (version ${ytdlpVersion}).`);
  } catch (err) {
    console.warn('⚠️ Warning: yt-dlp binary not found in PATH.');
  }
});
