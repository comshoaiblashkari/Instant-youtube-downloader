const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Extract Video ID from short or full links
function getYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Strategy 1: Cobalt API (Reliable multi-instance extractor)
async function fetchViaCobalt(videoUrl) {
    const cobaltInstances = [
        'https://api.cobalt.tools',
        'https://co.wuk.sh'
    ];

    for (const instance of cobaltInstances) {
        try {
            const response = await axios.post(instance, {
                url: videoUrl,
                videoQuality: '720'
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                timeout: 8000
            });

            if (response.data && (response.data.url || response.data.picker)) {
                return {
                    source: 'Cobalt Engine',
                    title: response.data.filename || 'YouTube Video',
                    downloadUrl: response.data.url || response.data.picker?.[0]?.url
                };
            }
        } catch (err) {
            console.log(`Cobalt instance (${instance}) failed, trying fallback...`);
        }
    }
    throw new Error('Cobalt instances unreachable');
}

// Strategy 2: Invidious API (Decentralized YouTube proxy)
async function fetchViaInvidious(videoId) {
    const invidiousInstances = [
        'https://inv.tux.pizza',
        'https://vid.puffyan.us',
        'https://invidious.nerqv.de'
    ];

    for (const instance of invidiousInstances) {
        try {
            const res = await axios.get(`${instance}/api/v1/videos/${videoId}`, { timeout: 8000 });
            const data = res.data;
            if (data && data.formatStreams && data.formatStreams.length > 0) {
                // Select highest quality stream with combined audio/video
                const stream = data.formatStreams[data.formatStreams.length - 1];
                return {
                    source: 'Invidious Mirror',
                    title: data.title,
                    thumbnail: data.videoThumbnails?.[0]?.url,
                    downloadUrl: stream.url
                };
            }
        } catch (err) {
            console.log(`Invidious instance (${instance}) failed...`);
        }
    }
    throw new Error('Invidious instances unreachable');
}

// Strategy 3: Local yt-dlp execution
function fetchViaYtDlp(videoUrl) {
    return new Promise((resolve, reject) => {
        const cmd = `yt-dlp --dump-json --no-warnings --extractor-args "youtube:player_client=android" "${videoUrl}"`;
        exec(cmd, { timeout: 15000 }, (error, stdout) => {
            if (error) return reject(error);
            try {
                const data = JSON.parse(stdout);
                resolve({
                    source: 'yt-dlp Local',
                    title: data.title,
                    thumbnail: data.thumbnail,
                    downloadUrl: data.url
                });
            } catch (e) {
                reject(e);
            }
        });
    });
}

// API Route
app.post('/api/fetch-video', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Please provide a valid YouTube URL' });

    const videoId = getYouTubeId(url);

    // Try Cobalt
    try {
        const result = await fetchViaCobalt(url);
        return res.json({ success: true, ...result });
    } catch (e) {
        console.log('Cobalt failed, attempting Invidious...');
    }

    // Try Invidious
    if (videoId) {
        try {
            const result = await fetchViaInvidious(videoId);
            return res.json({ success: true, ...result });
        } catch (e) {
            console.log('Invidious failed, attempting yt-dlp...');
        }
    }

    // Try yt-dlp
    try {
        const result = await fetchViaYtDlp(url);
        return res.json({ success: true, ...result });
    } catch (e) {
        console.log('yt-dlp failed:', e.message);
    }

    res.status(500).json({
        error: 'Unable to extract video streams. YouTube is blocking datacenter IPs.'
    });
});

app.listen(PORT, () => {
    console.log(`Server live on http://localhost:${PORT}`);
});
