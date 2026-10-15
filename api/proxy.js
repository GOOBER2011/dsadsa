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

    const contentType = targetResponse.headers.get('content-type') || '';

    // Permissive headers for iframe rendering
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // If HTML page, inject <base> tag so relative links and images load properly
    if (contentType.includes('text/html')) {
      let html = await targetResponse.text();
      const baseTag = `<base href="${url}" target="_self">`;

      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>${baseTag}`);
      } else {
        html = baseTag + html;
      }

      return res.status(targetResponse.status).send(html);
    }

    // Binary / non-HTML resources (images, JS, CSS)
    const buffer = await targetResponse.arrayBuffer();
    return res.status(targetResponse.status).send(Buffer.from(buffer));
  } catch (error) {
    return res.status(500).send(`Proxy Error: ${error.message}`);
  }
};
