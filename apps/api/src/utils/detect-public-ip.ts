import https from 'node:https';

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
