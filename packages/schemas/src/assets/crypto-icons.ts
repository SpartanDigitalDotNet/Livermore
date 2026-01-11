/**
 * Crypto Icon Utilities
 *
 * Helper functions for getting cryptocurrency icon URLs from the
 * spothq/cryptocurrency-icons GitHub repository.
 *
 * Repository: https://github.com/spothq/cryptocurrency-icons
 */

/**
 * Base URL for raw GitHub content
 */
const ICON_BASE_URL =
  'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color';

/**
 * Generic icon for unknown cryptocurrencies
 */
const FALLBACK_ICON = `${ICON_BASE_URL}/generic.svg`;

/**
 * SVG icon URL for black/white versions
 */
const ICON_BW_BASE_URL =
  'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/black';

/**
 * Get the colored SVG icon URL for a cryptocurrency symbol
 *
 * @param symbol - The cryptocurrency symbol (e.g., 'BTC', 'ETH')
 * @returns The URL to the colored SVG icon
 *
 * @example
 * getCryptoIconUrl('BTC') // Returns Bitcoin icon URL
 * getCryptoIconUrl('ETH') // Returns Ethereum icon URL
 */
export function getCryptoIconUrl(symbol: string): string {
  if (!symbol || symbol.trim() === '') {
    return FALLBACK_ICON;
  }

  return `${ICON_BASE_URL}/${symbol.toLowerCase()}.svg`;
}

/**
 * Get the black/white SVG icon URL for a cryptocurrency symbol
 * Useful for dark backgrounds or monochrome themes
 *
 * @param symbol - The cryptocurrency symbol (e.g., 'BTC', 'ETH')
 * @returns The URL to the black SVG icon
 */
export function getCryptoIconBwUrl(symbol: string): string {
  if (!symbol || symbol.trim() === '') {
    return FALLBACK_ICON;
  }

  return `${ICON_BW_BASE_URL}/${symbol.toLowerCase()}.svg`;
}

/**
 * Get the fallback icon URL for unknown symbols
 */
export function getFallbackIconUrl(): string {
  return FALLBACK_ICON;
}

/**
 * Symbols known to have icons in the spothq repository
 * This is a subset of the most common ones
 */
export const KNOWN_ICON_SYMBOLS = [
  'btc',
  'eth',
  'sol',
  'usdc',
  'usdt',
  'doge',
  'ada',
  'dot',
  'link',
  'avax',
  'matic',
  'uni',
  'atom',
  'ltc',
  'xrp',
  'bnb',
  'xlm',
  'algo',
  'fil',
  'aave',
  'mkr',
  'comp',
  'snx',
  'sushi',
  'crv',
  'yfi',
] as const;

export type KnownIconSymbol = (typeof KNOWN_ICON_SYMBOLS)[number];

/**
 * Check if a symbol has a known icon
 */
export function hasKnownIcon(symbol: string): boolean {
  return KNOWN_ICON_SYMBOLS.includes(symbol.toLowerCase() as KnownIconSymbol);
}

/**
 * Get icon data with fallback handling
 * Returns both the icon URL and whether it's a fallback
 */
export function getCryptoIconData(symbol: string): {
  url: string;
  isFallback: boolean;
} {
  if (!symbol || symbol.trim() === '' || !hasKnownIcon(symbol)) {
    return {
      url: FALLBACK_ICON,
      isFallback: true,
    };
  }

  return {
    url: getCryptoIconUrl(symbol),
    isFallback: false,
  };
}
