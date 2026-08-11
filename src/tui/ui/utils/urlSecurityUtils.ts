import url from 'node:url';

/**
 * Details about a deceptive URL.
 */
export interface DeceptiveUrlDetails {
  /** The Unicode version of the visually deceptive URL. */
  originalUrl: string;
  /** The ASCII-safe Punycode version of the URL. */
  punycodeUrl: string;
}

/**
 * Whether a hostname contains non-ASCII or Punycode markers.
 *
 * @param hostname The hostname to check.
 * @returns true if deceptive markers are found, false otherwise.
 */
function containsDeceptiveMarkers(hostname: string): boolean {
  return (
    hostname.toLowerCase().includes('xn--') || [...hostname].some((c) => c.charCodeAt(0) > 127)
  );
}

/**
 * Converts a URL (string or object) to its visually deceptive Unicode version.
 *
 * This function manually reconstructs the URL to bypass the automatic Punycode
 * conversion performed by the WHATWG URL class when setting the hostname.
 *
 * @param urlInput The URL string or URL object to convert.
 * @returns The reconstructed URL string with the hostname in Unicode.
 */
export function toUnicodeUrl(urlInput: string | URL): string {
  try {
    const urlObj = typeof urlInput === 'string' ? new URL(urlInput) : urlInput;
    const punycodeHost = urlObj.hostname;
    const unicodeHost = url.domainToUnicode(punycodeHost);

    // Reconstruct the URL manually because the WHATWG URL class automatically
    // Punycodes the hostname if we try to set it.
    const protocol = urlObj.protocol + '//';
    let credentials = '';
    if (urlObj.username) {
      const pass = urlObj.password ? `:${urlObj.password}` : '';
      credentials = `${urlObj.username}${pass}@`;
    }
    const port = urlObj.port ? ':' + urlObj.port : '';

    return `${protocol}${credentials}${unicodeHost}${port}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
  } catch {
    return typeof urlInput === 'string' ? urlInput : urlInput.href;
  }
}

/**
 * Extracts deceptive URL details if a URL hostname contains non-ASCII characters
 * or is already in Punycode.
 *
 * @param urlString The URL string to check.
 * @returns DeceptiveUrlDetails if a potential deceptive URL is detected, otherwise null.
 */
export function createWebSocketUrl(host: string, port: number, pathname = ''): string {
  const normalizedHost = host.trim().replace(/^\[|\]$/g, '');
  if (!normalizedHost || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid WebSocket endpoint.');
  }

  const isLoopback =
    normalizedHost === 'localhost' || normalizedHost === '127.0.0.1' || normalizedHost === '::1';
  const protocol = isLoopback ? 'ws' : 'wss';
  const urlHost = normalizedHost.includes(':') ? `[${normalizedHost}]` : normalizedHost;
  let normalizedPath = pathname;
  if (normalizedPath && !normalizedPath.startsWith('/')) {
    normalizedPath = `/${normalizedPath}`;
  }
  return new URL(`${protocol}${'://'}${urlHost}:${port}${normalizedPath}`).toString();
}

export function getDeceptiveUrlDetails(urlString: string): DeceptiveUrlDetails | null {
  try {
    if (!urlString.includes('://')) {
      return null;
    }

    const urlObj = new URL(urlString);

    if (!containsDeceptiveMarkers(urlObj.hostname)) {
      return null;
    }

    return {
      originalUrl: toUnicodeUrl(urlObj),
      punycodeUrl: urlObj.href,
    };
  } catch {
    // If URL parsing fails, it's not a valid URL we can safely analyze.
    return null;
  }
}
