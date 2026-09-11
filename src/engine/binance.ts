import { Candle, MarketType, Timeframe } from './types';

export function normalizeSymbol(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return 'BTCUSDT';
  if (cleaned.endsWith('USDT') || cleaned.endsWith('BUSD') || cleaned.endsWith('FDUSD')) {
    return cleaned;
  }
  return `${cleaned}USDT`;
}

export function formatCoinDisplayName(symbol: string): string {
  return symbol.replace(/(USDT|BUSD|FDUSD)$/, '');
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
}

export async function fetchBinanceKlines(
  symbol: string,
  interval: Timeframe = '5m',
  marketType: MarketType = 'futures',
  limit: number = 300
): Promise<Candle[]> {
  const cleanSymbol = normalizeSymbol(symbol);
  const baseUrl =
    marketType === 'futures'
      ? 'https://fapi.binance.com/fapi/v1/klines'
      : 'https://api.binance.com/api/v3/klines';

  const url = `${baseUrl}?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    // If futures fails for newly listed coin or vice-versa, try the alternative
    const altUrl =
      marketType === 'futures'
        ? `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`
        : `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;

    try {
      const altResponse = await fetch(altUrl);
      if (altResponse.ok) {
        const altData = await altResponse.json();
        return parseKlines(altData);
      }
    } catch {
      // ignore
    }
    throw new Error(`Failed to fetch klines for ${cleanSymbol}: HTTP ${response.status}`);
  }

  const rawData = await response.json();
  return parseKlines(rawData);
}

function parseKlines(rawData: unknown): Candle[] {
  if (!Array.isArray(rawData)) {
    throw new Error('Invalid candle data received from Binance API');
  }

  return rawData.map((item: unknown[]) => {
    const time = Number(item[0]);
    const open = Number(item[1]);
    const high = Number(item[2]);
    const low = Number(item[3]);
    const close = Number(item[4]);
    const volume = Number(item[5]);

    return {
      time,
      open,
      high,
      low,
      close,
      volume,
    };
  });
}

export async function fetchBinanceTicker24h(
  symbol: string,
  marketType: MarketType = 'futures'
): Promise<Ticker24h | null> {
  const cleanSymbol = normalizeSymbol(symbol);
  const baseUrl =
    marketType === 'futures'
      ? 'https://fapi.binance.com/fapi/v1/ticker/24hr'
      : 'https://api.binance.com/api/v3/ticker/24hr';

  try {
    const res = await fetch(`${baseUrl}?symbol=${cleanSymbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      symbol: cleanSymbol,
      lastPrice: Number(data.lastPrice),
      priceChangePercent: Number(data.priceChangePercent),
      highPrice: Number(data.highPrice),
      lowPrice: Number(data.lowPrice),
      volume: Number(data.volume),
    };
  } catch {
    return null;
  }
}
