import {
  Candle,
  CombinedSignal,
  PriceSource,
  RuleAResult,
  RuleBResult,
  Settings,
  SmoothingType,
  TrendDirection,
} from './types';

/**
 * Calculates price source from Candle
 */
export function getPriceSourceValue(candle: Candle, source: PriceSource): number {
  switch (source) {
    case 'hl2':
      return (candle.high + candle.low) / 2;
    case 'ohlc4':
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    case 'hlc3':
      return (candle.high + candle.low + candle.close) / 3;
    case 'close':
    default:
      return candle.close;
  }
}

/**
 * Exponential Moving Average (EMA)
 */
export function calculateEMA(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(0);
  if (values.length === 0 || length <= 0) return result;

  const k = 2 / (length + 1);

  // Initial SMA for first length elements or available elements
  const initialLength = Math.min(length, values.length);
  let sum = 0;
  for (let i = 0; i < initialLength; i++) {
    sum += values[i];
    result[i] = sum / (i + 1);
  }

  for (let i = initialLength; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }

  return result;
}

/**
 * Simple Moving Average (SMA)
 */
export function calculateSMA(values: number[], length: number): number[] {
  const result: number[] = new Array(values.length).fill(0);
  if (values.length === 0 || length <= 0) return result;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) {
      sum -= values[i - length];
      result[i] = sum / length;
    } else {
      result[i] = sum / (i + 1);
    }
  }

  return result;
}

/**
 * Wilder's Smoothing (RMA) for True Range (Volatility)
 */
export function calculateWildersSmoothing(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(0);
  if (values.length === 0 || period <= 0) return result;

  const initialCount = Math.min(period, values.length);
  let sum = 0;
  for (let i = 0; i < initialCount; i++) {
    sum += values[i];
    result[i] = sum / (i + 1);
  }

  for (let i = initialCount; i < values.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + values[i]) / period;
  }

  return result;
}

/**
 * Rule A — Trend Signal Calculator (Wilder's ATR + Base EMA + Ratchet Channels)
 */
export function calculateRuleA(candles: Candle[], settings: Settings): RuleAResult {
  const len = candles.length;
  if (len === 0) {
    return {
      base: [],
      volatility: [],
      upperBand: [],
      lowerBand: [],
      state: [],
      flipSignal: [],
      currentState: 'UP',
      currentBase: 0,
      currentUpper: 0,
      currentLower: 0,
      flippedCandlesAgo: 999,
      lastFlipType: null,
    };
  }

  // 1. True Range calculation
  const tr: number[] = new Array(len).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < len; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  // 2. Wilder's smoothed volatility (ATR)
  const volatility = calculateWildersSmoothing(tr, settings.volatilityPeriod);

  // 3. Price source array & Base trend line smoothing
  const priceSources = candles.map((c) => getPriceSourceValue(c, settings.priceSource));
  const base =
    settings.smoothingType === 'SMA'
      ? calculateSMA(priceSources, settings.smoothingLength)
      : calculateEMA(priceSources, settings.smoothingLength);

  // 4. Ratchet bands calculation
  const upperBand: number[] = new Array(len).fill(0);
  const lowerBand: number[] = new Array(len).fill(0);
  const state: TrendDirection[] = new Array(len).fill('UP');
  const flipSignal: ('BUY_FLIP' | 'SELL_FLIP' | null)[] = new Array(len).fill(null);

  const mult = settings.volatilityMultiplier;

  // Initialize first candle
  upperBand[0] = base[0] + mult * volatility[0];
  lowerBand[0] = base[0] - mult * volatility[0];
  state[0] = base[0] >= lowerBand[0] ? 'UP' : 'DOWN';

  for (let i = 1; i < len; i++) {
    const rawUpper = base[i] + mult * volatility[i];
    const rawLower = base[i] - mult * volatility[i];
    const prevState = state[i - 1];

    let currUpper = rawUpper;
    let currLower = rawLower;

    if (prevState === 'UP') {
      // Ratchet: lower line can only rise or stay flat (never drop back down while UP)
      currLower = Math.max(rawLower, lowerBand[i - 1]);
      currUpper = rawUpper;

      if (base[i] < currLower) {
        state[i] = 'DOWN';
        flipSignal[i] = 'SELL_FLIP';
        currUpper = rawUpper;
      } else {
        state[i] = 'UP';
      }
    } else {
      // Ratchet: upper line can only fall or stay flat (never rise back up while DOWN)
      currUpper = Math.min(rawUpper, upperBand[i - 1]);
      currLower = rawLower;

      if (base[i] > currUpper) {
        state[i] = 'UP';
        flipSignal[i] = 'BUY_FLIP';
        currLower = rawLower;
      } else {
        state[i] = 'DOWN';
      }
    }

    upperBand[i] = currUpper;
    lowerBand[i] = currLower;
  }

  // Find last flip info
  let flippedCandlesAgo = 999;
  let lastFlipType: 'BUY_FLIP' | 'SELL_FLIP' | null = null;
  for (let i = len - 1; i >= 0; i--) {
    if (flipSignal[i] !== null) {
      flippedCandlesAgo = len - 1 - i;
      lastFlipType = flipSignal[i];
      break;
    }
  }

  const lastIdx = len - 1;
  return {
    base,
    volatility,
    upperBand,
    lowerBand,
    state,
    flipSignal,
    currentState: state[lastIdx],
    currentBase: base[lastIdx],
    currentUpper: upperBand[lastIdx],
    currentLower: lowerBand[lastIdx],
    flippedCandlesAgo,
    lastFlipType,
  };
}

/**
 * Rule B — Momentum Signal Calculator (Typical Price + Mean Distance Normalization + EMA Oscillator)
 */
export function calculateRuleB(candles: Candle[], settings: Settings): RuleBResult {
  const len = candles.length;
  if (len === 0) {
    return {
      typicalPrice: [],
      smoothedPrice: [],
      rawValues: [],
      momentum: [],
      currentMomentum: 0,
      zoneState: [],
      exitSignal: [],
      currentZone: 'IN_RANGE',
      exitedCandlesAgo: 999,
      lastExitType: null,
    };
  }

  // 1. Typical price = (high + low + close) / 3
  const typicalPrice = candles.map((c) => (c.high + c.low + c.close) / 3);

  // 2. Smooth typical price using EMA over channelLength (30)
  const smoothedPrice = calculateEMA(typicalPrice, settings.channelLength);

  // 3. Absolute deviation & Mean Absolute Distance over channelLength (30)
  const absDeviations = typicalPrice.map((tp, idx) => Math.abs(tp - smoothedPrice[idx]));
  const avgDistance = calculateSMA(absDeviations, settings.channelLength);

  // 4. Raw value = (typical price - smoothed price) / (0.015 * avgDistance)
  const rawValues = typicalPrice.map((tp, idx) => {
    const dist = avgDistance[idx];
    if (dist <= 1e-10) return 0;
    return (tp - smoothedPrice[idx]) / (0.015 * dist);
  });

  // 5. Final momentum reading = EMA of raw value over averageLength (63)
  const momentum = calculateEMA(rawValues, settings.averageLength);

  // 6. Zone states and Exit triggers
  const zoneState: ('OVERSOLD' | 'OVERBOUGHT' | 'IN_RANGE')[] = new Array(len).fill('IN_RANGE');
  const exitSignal: ('BULLISH_EXIT' | 'BEARISH_EXIT' | null)[] = new Array(len).fill(null);

  const obThreshold = settings.overboughtLevel1; // 60
  const osThreshold = settings.oversoldLevel1; // -60

  for (let i = 0; i < len; i++) {
    const val = momentum[i];
    if (val <= osThreshold) {
      zoneState[i] = 'OVERSOLD';
    } else if (val >= obThreshold) {
      zoneState[i] = 'OVERBOUGHT';
    } else {
      zoneState[i] = 'IN_RANGE';
    }

    if (i > 0) {
      const prevVal = momentum[i - 1];
      // Bullish exit: crossed back above oversold threshold
      if (prevVal <= osThreshold && val > osThreshold) {
        exitSignal[i] = 'BULLISH_EXIT';
      }
      // Bearish exit: crossed back below overbought threshold
      else if (prevVal >= obThreshold && val < obThreshold) {
        exitSignal[i] = 'BEARISH_EXIT';
      }
    }
  }

  let exitedCandlesAgo = 999;
  let lastExitType: 'BULLISH_EXIT' | 'BEARISH_EXIT' | null = null;
  for (let i = len - 1; i >= 0; i--) {
    if (exitSignal[i] !== null) {
      exitedCandlesAgo = len - 1 - i;
      lastExitType = exitSignal[i];
      break;
    }
  }

  const lastIdx = len - 1;
  return {
    typicalPrice,
    smoothedPrice,
    rawValues,
    momentum,
    currentMomentum: momentum[lastIdx] ?? 0,
    zoneState,
    exitSignal,
    currentZone: zoneState[lastIdx] ?? 'IN_RANGE',
    exitedCandlesAgo,
    lastExitType,
  };
}

/**
 * Combines Rule A and Rule B to evaluate Buy / Sell Confluence
 */
export function evaluateCombinedSignal(
  ruleA: RuleAResult,
  ruleB: RuleBResult,
  settings: Settings
): CombinedSignal {
  const window = Math.max(1, settings.confluenceWindow || 3);

  // Check recent candle window for Rule A flip
  const aFlippedRecently = ruleA.flippedCandlesAgo <= window;
  const isRuleAUp = ruleA.currentState === 'UP';
  const isRuleADown = ruleA.currentState === 'DOWN';

  // Check Rule B condition
  // Rule B oversold zone OR recently exited oversold zone (Bullish)
  const isRuleBBullish =
    ruleB.currentZone === 'OVERSOLD' ||
    (ruleB.lastExitType === 'BULLISH_EXIT' && ruleB.exitedCandlesAgo <= window);

  // Rule B overbought zone OR recently exited overbought zone (Bearish)
  const isRuleBBearish =
    ruleB.currentZone === 'OVERBOUGHT' ||
    (ruleB.lastExitType === 'BEARISH_EXIT' && ruleB.exitedCandlesAgo <= window);

  if (!settings.requireRuleB) {
    // Single Rule Mode (Rule A only)
    if (aFlippedRecently && ruleA.lastFlipType === 'BUY_FLIP') {
      return {
        signal: 'BUY',
        reason: `Rule A flipped to UPTREND (${ruleA.flippedCandlesAgo === 0 ? 'just now' : `${ruleA.flippedCandlesAgo}c ago`})`,
        ruleAStatus: 'UPTREND (Active Flip)',
        ruleBStatus: `Momentum: ${ruleB.currentMomentum.toFixed(1)} (Bypassed)`,
        ruleAState: ruleA.currentState,
        ruleBMomentum: ruleB.currentMomentum,
        ruleBZone: ruleB.currentZone,
        isConfirmed: true,
        candleIndex: ruleA.flippedCandlesAgo,
      };
    }

    if (aFlippedRecently && ruleA.lastFlipType === 'SELL_FLIP') {
      return {
        signal: 'SELL',
        reason: `Rule A flipped to DOWNTREND (${ruleA.flippedCandlesAgo === 0 ? 'just now' : `${ruleA.flippedCandlesAgo}c ago`})`,
        ruleAStatus: 'DOWNTREND (Active Flip)',
        ruleBStatus: `Momentum: ${ruleB.currentMomentum.toFixed(1)} (Bypassed)`,
        ruleAState: ruleA.currentState,
        ruleBMomentum: ruleB.currentMomentum,
        ruleBZone: ruleB.currentZone,
        isConfirmed: true,
        candleIndex: ruleA.flippedCandlesAgo,
      };
    }
  } else {
    // Confluence Mode (Rule A + Rule B together)
    // BUY Alert: Rule A flipped to UP AND Rule B is in/leaving oversold zone
    if (aFlippedRecently && ruleA.lastFlipType === 'BUY_FLIP' && isRuleBBullish) {
      return {
        signal: 'BUY',
        reason: `Rule A UPTREND + Rule B Oversold (${ruleB.currentMomentum.toFixed(1)}) Confluence`,
        ruleAStatus: 'UPTREND Confirmed',
        ruleBStatus: `Oversold Rebound (${ruleB.currentMomentum.toFixed(1)})`,
        ruleAState: ruleA.currentState,
        ruleBMomentum: ruleB.currentMomentum,
        ruleBZone: ruleB.currentZone,
        isConfirmed: true,
        candleIndex: Math.min(ruleA.flippedCandlesAgo, ruleB.exitedCandlesAgo),
      };
    }

    // SELL Alert: Rule A flipped to DOWN AND Rule B is in/leaving overbought zone
    if (aFlippedRecently && ruleA.lastFlipType === 'SELL_FLIP' && isRuleBBearish) {
      return {
        signal: 'SELL',
        reason: `Rule A DOWNTREND + Rule B Overbought (${ruleB.currentMomentum.toFixed(1)}) Confluence`,
        ruleAStatus: 'DOWNTREND Confirmed',
        ruleBStatus: `Overbought Exhaustion (${ruleB.currentMomentum.toFixed(1)})`,
        ruleAState: ruleA.currentState,
        ruleBMomentum: ruleB.currentMomentum,
        ruleBZone: ruleB.currentZone,
        isConfirmed: true,
        candleIndex: Math.min(ruleA.flippedCandlesAgo, ruleB.exitedCandlesAgo),
      };
    }
  }

  // Default Neutral / Watching
  const ruleAStr = isRuleAUp ? 'Trending UP' : isRuleADown ? 'Trending DOWN' : 'Flat';
  const ruleBStr =
    ruleB.currentZone === 'OVERSOLD'
      ? `Oversold (${ruleB.currentMomentum.toFixed(1)})`
      : ruleB.currentZone === 'OVERBOUGHT'
      ? `Overbought (${ruleB.currentMomentum.toFixed(1)})`
      : `Neutral (${ruleB.currentMomentum.toFixed(1)})`;

  return {
    signal: 'NEUTRAL',
    reason: 'Waiting for confluence breakout',
    ruleAStatus: ruleAStr,
    ruleBStatus: ruleBStr,
    ruleAState: ruleA.currentState,
    ruleBMomentum: ruleB.currentMomentum,
    ruleBZone: ruleB.currentZone,
    isConfirmed: false,
    candleIndex: 0,
  };
}
