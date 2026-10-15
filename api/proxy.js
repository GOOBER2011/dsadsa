module.exports = async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Error: Missing target URL parameter.');
  }

  try {
    const targetUrlObj = new URL(url);
    const targetOrigin = targetUrlObj.origin;

    const targetResponse = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const contentType = targetResponse.headers.get('content-type') || '';

    // Strip frame-blocking and CSP security headers
    const responseHeaders = Object.fromEntries(targetResponse.headers.entries());
    delete responseHeaders['content-security-policy'];
    delete responseHeaders['content-security-policy-report-only'];
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['frame-options'];

    Object.keys(responseHeaders).forEach(key => {
      res.setHeader(key, responseHeaders[key]);
    });

    // Set open CORS and iframe options
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    if (contentType.includes('text/html')) {
      let html = await targetResponse.text();

      // Intercept relative fetch/XHR calls made by client scripts inside target pages
      const injectionScript = `
        <script>
          (function() {
            const ORIGIN = "${targetOrigin}";
            const PROXY_PREFIX = "/api/proxy?url=";

            function resolveUrl(relativeUrl) {
              try {
                if (!relativeUrl || typeof relativeUrl !== 'string') return relativeUrl;
                if (relativeUrl.startsWith('/api/proxy')) return relativeUrl;
                const absolute = new URL(relativeUrl, ORIGIN).href;
                return PROXY_PREFIX + encodeURIComponent(absolute);
              } catch(e) {
                return relativeUrl;
              }
            }

            const originalFetch = window.fetch;
            window.fetch = function(resource, init) {
              if (typeof resource === 'string') {
                resource = resolveUrl(resource);
              } else if (resource && resource.url) {
                resource = new Request(resolveUrl(resource.url), resource);
              }
              return originalFetch.call(this, resource, init);
            };

            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              return originalOpen.call(this, method, resolveUrl(url), ...rest);
            };
          })();
        </script>
        <base href="${url}">
      `;

      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${injectionScript}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>${injectionScript}`);
      } else {
        html = injectionScript + html;
      }

      return res.status(targetResponse.status).send(html);
    }

    const buffer = await targetResponse.arrayBuffer();
    return res.status(targetResponse.status).send(Buffer.from(buffer));
  } catch (error) {
    return res.status(500).send(`Proxy Error: ${error.message}`);
  }
};
