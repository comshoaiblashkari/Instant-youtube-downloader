const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const Y2MATE_HEADERS = {
  'accept': '*/*',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'origin': 'https://www.y2mate.com',
  'referer': 'https://www.y2mate.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'x-requested-with': 'XMLHttpRequest'
};

// 1. ANALYZE YOUTUBE URL
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing YouTube URL' });

  try {
    const params = new URLSearchParams({
      k_query: url,
      k_page: 'home',
      hl: 'en',
      q_auto: '0'
    });

    const response = await axios.post(
      'https://www.y2mate.com/mates/analyzeV2/ajax',
      params.toString(),
      { headers: Y2MATE_HEADERS, timeout: 10000 }
    );

    const data = response.data;
    if (data.status !== 'ok') {
      return res.status(500).json({ error: 'Failed to analyze video' });
    }

    // Process formats (mp4, mp3)
    const videoFormats = [];
    const mp4Links = data.links?.mp4 || {};

    for (const key in mp4Links) {
      const item = mp4Links[key];
      videoFormats.push({
        quality: item.q_text,
        size: item.size,
        k: item.k
      });
    }

    res.json({
      vid: data.vid,
      title: data.title,
      formats: videoFormats
    });

  } catch (err) {
    console.error('Y2Mate analyze error:', err.message);
    res.status(500).json({ error: 'Unable to reach Y2Mate API engine' });
  }
});

// 2. CONVERT & GET DIRECT DOWNLOAD LINK
app.post('/api/convert', async (req, res) => {
  const { vid, k } = req.body;
  if (!vid || !k) return res.status(400).json({ error: 'Missing vid or k token' });

  try {
    const params = new URLSearchParams({ vid, k });

    const response = await axios.post(
      'https://www.y2mate.com/mates/convertV2/ajax',
      params.toString(),
      { headers: Y2MATE_HEADERS, timeout: 15000 }
    );

    const data = response.data;
    if (data.status === 'ok' && data.dlink) {
      return res.json({
        success: true,
        downloadUrl: data.dlink,
        title: data.title
      });
    }

    res.status(500).json({ error: 'Conversion failed or download link expired' });

  } catch (err) {
    console.error('Y2Mate convert error:', err.message);
    res.status(500).json({ error: 'Failed to convert video' });
  }
});

app.listen(PORT, () => {
  console.log(`⚡ Direct Downloader Engine running on port ${PORT}`);
});
