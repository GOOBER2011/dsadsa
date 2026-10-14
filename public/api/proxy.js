module.exports = async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Error: Missing target URL parameter.');
  }

  try {
    const targetResponse = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const contentType = targetResponse.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Prevent target websites from blocking iframe embedding
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    const data = await targetResponse.arrayBuffer();
    return res.status(targetResponse.status).send(Buffer.from(data));
  } catch (error) {
    return res.status(500).send(`Proxy Error: ${error.message}`);
  }
};
