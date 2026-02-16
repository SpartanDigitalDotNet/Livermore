import https from 'node:https';
import http from 'node:http';

/**
 * Detect the public IP address of this instance via ipify.org.
 *
 * - Uses node:https (no npm dependencies)
 * - Returns trimmed IP string on success, null on any failure
 * - NEVER throws -- all errors resolve to null
 * - Timeout defaults to 3 seconds to avoid blocking startup
 *
 * @param timeoutMs - Maximum time to wait for response (default: 3000ms)
 * @returns Public IP address string or null
 */
export async function detectPublicIp(timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org', { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data.trim() || null);
      });
    });

    req.on('error', () => {
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Detect the country of an IP address via ip-api.com (free tier, HTTP only).
 *
 * - Uses node:http (ip-api.com free tier requires HTTP, not HTTPS)
 * - No API key or signup required (45 req/min limit — plenty for ~4 exchanges)
 * - Returns ISO 3166-1 alpha-2 country code (e.g. "US", "GB") or null
 * - NEVER throws -- all errors resolve to null
 *
 * @param ip - Public IP address to geolocate
 * @param timeoutMs - Maximum time to wait for response (default: 3000ms)
 * @returns Two-letter country code or null
 */
export async function detectCountry(ip: string, timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://ip-api.com/json/${ip}?fields=countryCode`, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(typeof json.countryCode === 'string' ? json.countryCode : null);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => {
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}
