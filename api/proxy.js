module.exports = async function handler(req, res) {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('Error: Missing target URL parameter.');
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const targetOrigin = parsedUrl.origin;

    // Forward HTTP method and body for POST/PUT requests (e.g. form submissions)
    const fetchOptions = {
      method: req.method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      redirect: 'manual' // Intercept redirects so they stay inside the proxy
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
    }

    const targetResponse = await fetch(targetUrl, fetchOptions);

    // Intercept 301, 302, 307, 308 redirects and rewrite location header
    if ([301, 302, 303, 307, 308].includes(targetResponse.status)) {
      const location = targetResponse.headers.get('location');
      if (location) {
        const resolvedLocation = new URL(location, targetUrl).href;
        res.setHeader('Location', `/api/proxy?url=${encodeURIComponent(resolvedLocation)}`);
        return res.status(targetResponse.status).end();
      }
    }

    const contentType = targetResponse.headers.get('content-type') || '';

    // Strip restrictive headers that break iframe embedding or content decoding
    const headersToIgnore = new Set([
      'content-encoding',
      'content-length',
      'transfer-encoding',
      'connection',
      'content-security-policy',
      'content-security-policy-report-only',
      'x-frame-options',
      'frame-options',
      'clear-site-data'
    ]);

    targetResponse.headers.forEach((value, key) => {
      if (!headersToIgnore.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    // Enforce open CORS and framing permissions
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    // 1. Process HTML Content
    if (contentType.includes('text/html')) {
      let html = await targetResponse.text();
      const proxyPrefix = '/api/proxy?url=';

      // Server-side rewrite of href, src, and action attributes
      html = html.replace(/(href|src|action)\s*=\s*["']([^"']+)["']/gi, (match, attr, value) => {
        if (value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('#')) {
          return match;
        }
        try {
          const absolute = new URL(value, targetUrl).href;
          return `${attr}="${proxyPrefix}${encodeURIComponent(absolute)}"`;
        } catch (e) {
          return match;
        }
      });

      // Advanced client-side injection script for dynamic requests, link clicks, and forms
      const injectionScript = `
        <script>
          (function() {
            const TARGET_ORIGIN = "${targetOrigin}";
            const TARGET_URL = "${targetUrl}";
            const PROXY_PREFIX = "/api/proxy?url=";

            function wrapUrl(url) {
              if (!url || typeof url !== 'string') return url;
              if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) return url;
              if (url.startsWith('/api/proxy')) return url;
              try {
                const abs = new URL(url, TARGET_URL).href;
                return PROXY_PREFIX + encodeURIComponent(abs);
              } catch(e) {
                return url;
              }
            }

            // Hook window.fetch
            const origFetch = window.fetch;
            window.fetch = function(resource, init) {
              if (typeof resource === 'string') {
                resource = wrapUrl(resource);
              } else if (resource && resource.url) {
                resource = new Request(wrapUrl(resource.url), resource);
              }
              return origFetch.call(this, resource, init);
            };

            // Hook XMLHttpRequest
            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              return origOpen.call(this, method, wrapUrl(url), ...rest);
            };

            // Intercept form submissions
            document.addEventListener('submit', function(e) {
              const form = e.target;
              if (form && form.action) {
                form.action = wrapUrl(form.action);
              }
            }, true);

            // Intercept clicks on anchor tags so user navigation stays inside proxy
            document.addEventListener('click', function(e) {
              const anchor = e.target.closest('a');
              if (anchor && anchor.href && !anchor.href.includes('/api/proxy')) {
                anchor.href = wrapUrl(anchor.href);
              }
            }, true);
          })();
        </script>
        <base href="${targetUrl}">
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

    // 2. Process CSS Content (rewrites relative url() imports for background images and fonts)
    if (contentType.includes('text/css')) {
      let css = await targetResponse.text();
      css = css.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, urlValue) => {
        if (urlValue.startsWith('data:')) return match;
        try {
          const abs = new URL(urlValue, targetUrl).href;
          return `url('/api/proxy?url=${encodeURIComponent(abs)}')`;
        } catch (e) {
          return match;
        }
      });
      return res.status(targetResponse.status).send(css);
    }

    // 3. Binary & Media Assets (images, fonts, audio, video)
    const buffer = await targetResponse.arrayBuffer();
    return res.status(targetResponse.status).send(Buffer.from(buffer));
  } catch (error) {
    return res.status(500).send(`Proxy Error: ${error.message}`);
  }
};
