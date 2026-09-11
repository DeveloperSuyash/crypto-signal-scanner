export type MarketType = 'futures' | 'spot';

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export type PriceSource = 'hl2' | 'close' | 'ohlc4' | 'hlc3';

export type SmoothingType = 'EMA' | 'SMA';

export type SignalType = 'BUY' | 'SELL' | 'NEUTRAL';

export type TrendDirection = 'UP' | 'DOWN';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Settings {
  marketType: MarketType;
  interval: Timeframe;
  // Rule A (Trend Signal)
  priceSource: PriceSource;
  volatilityPeriod: number; // default 40
  volatilityMultiplier: number; // default 12
  smoothingType: SmoothingType; // default EMA
  smoothingLength: number; // default 10
  // Rule B (Momentum Signal)
  channelLength: number; // default 30
  averageLength: number; // default 63
  overboughtLevel1: number; // default 60
  overboughtLevel2: number; // default 53
  oversoldLevel1: number; // default -60
  oversoldLevel2: number; // default -53
  // Confluence & Execution
  requireRuleB: boolean; // default true
  confluenceWindow: number; // 1-3 candles, default 3
  refreshIntervalSec: number; // default 15
}

export interface RuleAResult {
  base: number[];
  volatility: number[];
  upperBand: number[];
  lowerBand: number[];
  state: TrendDirection[]; // 'UP' | 'DOWN'
  flipSignal: ('BUY_FLIP' | 'SELL_FLIP' | null)[]; // fires only on the candle of flip
  currentState: TrendDirection;
  currentBase: number;
  currentUpper: number;
  currentLower: number;
  flippedCandlesAgo: number; // how many candles ago the last flip occurred
  lastFlipType: 'BUY_FLIP' | 'SELL_FLIP' | null;
}

export interface RuleBResult {
  typicalPrice: number[];
  smoothedPrice: number[];
  rawValues: number[];
  momentum: number[];
  currentMomentum: number;
  zoneState: ('OVERSOLD' | 'OVERBOUGHT' | 'IN_RANGE')[];
  exitSignal: ('BULLISH_EXIT' | 'BEARISH_EXIT' | null)[];
  currentZone: 'OVERSOLD' | 'OVERBOUGHT' | 'IN_RANGE';
  exitedCandlesAgo: number;
  lastExitType: 'BULLISH_EXIT' | 'BEARISH_EXIT' | null;
}

export interface CombinedSignal {
  signal: SignalType;
  reason: string;
  ruleAStatus: string;
  ruleBStatus: string;
  ruleAState: TrendDirection;
  ruleBMomentum: number;
  ruleBZone: string;
  isConfirmed: boolean;
  candleIndex: number;
}

export interface CoinAnalysis {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  candles: Candle[];
  ruleA: RuleAResult;
  ruleB: RuleBResult;
  combinedSignal: CombinedSignal;
  lastUpdated: number;
  error?: string;
}

export interface AlertLog {
  id: string;
  symbol: string;
  signal: 'BUY' | 'SELL';
  price: number;
  timestamp: number;
  timeStr: string;
  timeframe: string;
  marketType: MarketType;
  ruleAReason: string;
  ruleBReason: string;
}
