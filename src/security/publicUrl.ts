import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { URL } from 'node:url';
import { config } from '../config/index.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const CRAWLER_HEADERS = {
  'User-Agent': 'RagBotWebsiteVerifier/1.0 (+https://example.invalid/bot)'
};

export class UnsafeWebsiteUrlError extends Error {}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function parseHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeWebsiteUrlError('Website URL must be a valid absolute URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeWebsiteUrlError('Only HTTP and HTTPS website URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new UnsafeWebsiteUrlError('Website URLs must not contain credentials.');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    throw new UnsafeWebsiteUrlError('Local network hosts are not allowed.');
  }
  url.hash = '';
  return url;
}

/** Resolves every current DNS answer and rejects private or special-purpose IPs. */
export async function assertPublicWebsiteUrl(input: string): Promise<URL> {
  const url = parseHttpUrl(input);
  // WHATWG URL retains square brackets around IPv6 literals in `hostname`.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new UnsafeWebsiteUrlError('Private network addresses are not allowed.');
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new UnsafeWebsiteUrlError('Website host must resolve only to public IP addresses.');
  }
  return url;
}

/**
 * Fetches bounded public content and follows at most three redirects that stay
 * on the expected hostname. Every redirect target is independently revalidated.
 */
export async function fetchPublicWebsiteContent(
  input: string,
  expectedHostname?: string
): Promise<{ url: string; contentType: string; body: string }> {
  let current = await assertPublicWebsiteUrl(input);
  const allowedHostname = expectedHostname ?? current.hostname;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await axios.get<string>(current.toString(), {
      headers: CRAWLER_HEADERS,
      timeout: config.crawlTimeoutMs,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 400
    });

    if (response.status >= 300) {
      const location = response.headers.location;
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new UnsafeWebsiteUrlError('Website redirect could not be safely followed.');
      }
      const target = new URL(location, current);
      if (target.hostname !== allowedHostname) {
        throw new UnsafeWebsiteUrlError('Website redirects must stay on the verified hostname.');
      }
      current = await assertPublicWebsiteUrl(target.toString());
      continue;
    }

    return {
      url: current.toString(),
      contentType: String(response.headers['content-type'] || '').toLowerCase(),
      body: response.data
    };
  }

  throw new UnsafeWebsiteUrlError('Website redirect limit exceeded.');
}

export async function fetchVerifiedWebsiteHtml(input: string): Promise<{ url: string; html: string }> {
  const response = await fetchPublicWebsiteContent(input);
  if (!response.contentType.includes('text/html')) {
    throw new UnsafeWebsiteUrlError('Website verification requires an HTML response.');
  }
  return { url: response.url, html: response.body };
}
