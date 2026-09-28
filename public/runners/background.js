// Capacitor Background Runner script.
// Runs in a standalone JS context outside the WebView so signals can still
// be detected (and notified) while the app is backgrounded or the user is
// switching between other apps. No imports are available here, so the
// indicator math is duplicated from src/engine/indicators.ts.

var DEFAULT_SETTINGS = {
  marketType: 'futures',
  interval: '5m',
  priceSource: 'hl2',
  volatilityPeriod: 40,
  volatilityMultiplier: 1.5,
  smoothingType: 'EMA',
  smoothingLength: 10,
  channelLength: 30,
  averageLength: 63,
  overboughtLevel1: 60,
  oversoldLevel1: -60,
  requireRuleB: true,
  confluenceWindow: 3,
};

var DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BOMEUSDT', 'DOGEUSDT'];

function getPriceSourceValue(c, source) {
  switch (source) {
    case 'ohlc4':
      return (c.open + c.high + c.low + c.close) / 4;
    case 'hlc3':
      return (c.high + c.low + c.close) / 3;
    case 'close':
      return c.close;
    default:
      return (c.high + c.low) / 2;
  }
}

function calculateEMA(values, length) {
  var result = new Array(values.length).fill(0);
  if (values.length === 0 || length <= 0) return result;
  var k = 2 / (length + 1);
  var initialLength = Math.min(length, values.length);
  var sum = 0;
  for (var i = 0; i < initialLength; i++) {
    sum += values[i];
    result[i] = sum / (i + 1);
  }
  for (var j = initialLength; j < values.length; j++) {
    result[j] = values[j] * k + result[j - 1] * (1 - k);
  }
  return result;
}

function calculateSMA(values, length) {
  var result = new Array(values.length).fill(0);
  if (values.length === 0 || length <= 0) return result;
  var sum = 0;
  for (var i = 0; i < values.length; i++) {
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

function calculateWildersSmoothing(values, period) {
  var result = new Array(values.length).fill(0);
  if (values.length === 0 || period <= 0) return result;
  var initialCount = Math.min(period, values.length);
  var sum = 0;
  for (var i = 0; i < initialCount; i++) {
    sum += values[i];
    result[i] = sum / (i + 1);
  }
  for (var j = initialCount; j < values.length; j++) {
    result[j] = (result[j - 1] * (period - 1) + values[j]) / period;
  }
  return result;
}

function calculateRuleA(candles, settings) {
  var len = candles.length;
  var tr = new Array(len).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (var i = 1; i < len; i++) {
    var high = candles[i].high;
    var low = candles[i].low;
    var prevClose = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  var volatility = calculateWildersSmoothing(tr, settings.volatilityPeriod);
  var priceSources = candles.map(function (c) {
    return getPriceSourceValue(c, settings.priceSource);
  });
  var base =
    settings.smoothingType === 'SMA'
      ? calculateSMA(priceSources, settings.smoothingLength)
      : calculateEMA(priceSources, settings.smoothingLength);

  var upperBand = new Array(len).fill(0);
  var lowerBand = new Array(len).fill(0);
  var state = new Array(len).fill('UP');
  var flipSignal = new Array(len).fill(null);
  var mult = settings.volatilityMultiplier;

  upperBand[0] = base[0] + mult * volatility[0];
  lowerBand[0] = base[0] - mult * volatility[0];
  state[0] = base[0] >= lowerBand[0] ? 'UP' : 'DOWN';

  for (var k = 1; k < len; k++) {
    var rawUpper = base[k] + mult * volatility[k];
    var rawLower = base[k] - mult * volatility[k];
    var prevState = state[k - 1];
    var currUpper = rawUpper;
    var currLower = rawLower;

    if (prevState === 'UP') {
      currLower = Math.max(rawLower, lowerBand[k - 1]);
      currUpper = rawUpper;
      if (base[k] < currLower) {
        state[k] = 'DOWN';
        flipSignal[k] = 'SELL_FLIP';
      } else {
        state[k] = 'UP';
      }
    } else {
      currUpper = Math.min(rawUpper, upperBand[k - 1]);
      currLower = rawLower;
      if (base[k] > currUpper) {
        state[k] = 'UP';
        flipSignal[k] = 'BUY_FLIP';
      } else {
        state[k] = 'DOWN';
      }
    }

    upperBand[k] = currUpper;
    lowerBand[k] = currLower;
  }

  var flippedCandlesAgo = 999;
  var lastFlipType = null;
  for (var m = len - 1; m >= 0; m--) {
    if (flipSignal[m] !== null) {
      flippedCandlesAgo = len - 1 - m;
      lastFlipType = flipSignal[m];
      break;
    }
  }

  var lastIdx = len - 1;
  return {
    currentState: state[lastIdx],
    flippedCandlesAgo: flippedCandlesAgo,
    lastFlipType: lastFlipType,
  };
}

function calculateRuleB(candles, settings) {
  var len = candles.length;
  var typicalPrice = candles.map(function (c) {
    return (c.high + c.low + c.close) / 3;
  });
  var smoothedPrice = calculateEMA(typicalPrice, settings.channelLength);
  var absDeviations = typicalPrice.map(function (tp, idx) {
    return Math.abs(tp - smoothedPrice[idx]);
  });
  var avgDistance = calculateSMA(absDeviations, settings.channelLength);
  var rawValues = typicalPrice.map(function (tp, idx) {
    var dist = avgDistance[idx];
    if (dist <= 1e-10) return 0;
    return (tp - smoothedPrice[idx]) / (0.015 * dist);
  });
  var momentum = calculateEMA(rawValues, settings.averageLength);

  var zoneState = new Array(len).fill('IN_RANGE');
  var exitSignal = new Array(len).fill(null);
  var obThreshold = settings.overboughtLevel1;
  var osThreshold = settings.oversoldLevel1;

  for (var i = 0; i < len; i++) {
    var val = momentum[i];
    if (val <= osThreshold) zoneState[i] = 'OVERSOLD';
    else if (val >= obThreshold) zoneState[i] = 'OVERBOUGHT';
    else zoneState[i] = 'IN_RANGE';

    if (i > 0) {
      var prevVal = momentum[i - 1];
      if (prevVal <= osThreshold && val > osThreshold) exitSignal[i] = 'BULLISH_EXIT';
      else if (prevVal >= obThreshold && val < obThreshold) exitSignal[i] = 'BEARISH_EXIT';
    }
  }

  var exitedCandlesAgo = 999;
  var lastExitType = null;
  for (var j = len - 1; j >= 0; j--) {
    if (exitSignal[j] !== null) {
      exitedCandlesAgo = len - 1 - j;
      lastExitType = exitSignal[j];
      break;
    }
  }

  var lastIdx = len - 1;
  return {
    currentMomentum: momentum[lastIdx],
    currentZone: zoneState[lastIdx],
    exitedCandlesAgo: exitedCandlesAgo,
    lastExitType: lastExitType,
  };
}

function evaluateCombinedSignal(ruleA, ruleB, settings) {
  var window = Math.max(1, settings.confluenceWindow || 3);
  var aFlippedRecently = ruleA.flippedCandlesAgo <= window;

  var isRuleBBullish =
    ruleB.currentZone === 'OVERSOLD' ||
    (ruleB.lastExitType === 'BULLISH_EXIT' && ruleB.exitedCandlesAgo <= window);
  var isRuleBBearish =
    ruleB.currentZone === 'OVERBOUGHT' ||
    (ruleB.lastExitType === 'BEARISH_EXIT' && ruleB.exitedCandlesAgo <= window);

  if (!settings.requireRuleB) {
    if (aFlippedRecently && ruleA.lastFlipType === 'BUY_FLIP') {
      return { signal: 'BUY', reason: 'Rule A flipped to UPTREND' };
    }
    if (aFlippedRecently && ruleA.lastFlipType === 'SELL_FLIP') {
      return { signal: 'SELL', reason: 'Rule A flipped to DOWNTREND' };
    }
  } else {
    if (aFlippedRecently && ruleA.lastFlipType === 'BUY_FLIP' && isRuleBBullish) {
      return { signal: 'BUY', reason: 'Rule A UPTREND + Rule B Oversold Confluence' };
    }
    if (aFlippedRecently && ruleA.lastFlipType === 'SELL_FLIP' && isRuleBBearish) {
      return { signal: 'SELL', reason: 'Rule A DOWNTREND + Rule B Overbought Confluence' };
    }
  }

  return { signal: 'NEUTRAL', reason: 'Waiting for confluence breakout' };
}

function normalizeSymbol(input) {
  var cleaned = String(input).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return 'BTCUSDT';
  if (cleaned.endsWith('USDT') || cleaned.endsWith('BUSD') || cleaned.endsWith('FDUSD')) return cleaned;
  return cleaned + 'USDT';
}

async function fetchKlines(symbol, interval, marketType, limit) {
  var base =
    marketType === 'futures'
      ? 'https://fapi.binance.com/fapi/v1/klines'
      : 'https://api.binance.com/api/v3/klines';
  var res = await fetch(base + '?symbol=' + symbol + '&interval=' + interval + '&limit=' + limit);
  if (!res.ok) throw new Error('klines fetch failed: ' + res.status);
  var data = await res.json();
  return data.map(function (item) {
    return {
      open: Number(item[1]),
      high: Number(item[2]),
      low: Number(item[3]),
      close: Number(item[4]),
    };
  });
}

function readJSON(key, fallback) {
  try {
    var stored = CapacitorKV.get(key);
    return stored && stored.value ? JSON.parse(stored.value) : fallback;
  } catch (e) {
    return fallback;
  }
}

// Called immediately (while the app is foregrounded) whenever the watchlist
// or settings change, so the periodic background check always uses
// up-to-date config.
addEventListener('syncConfig', function (resolve, reject, args) {
  try {
    if (args && args.watchlist) CapacitorKV.set('watchlist', JSON.stringify(args.watchlist));
    if (args && args.settings) CapacitorKV.set('settings', JSON.stringify(args.settings));
    resolve();
  } catch (err) {
    reject(err);
  }
});

// Scheduled periodically by the OS (min. ~15 minutes on Android) while the
// app is backgrounded.
addEventListener('checkSignals', function (resolve, reject) {
  (async function () {
    try {
      var watchlist = readJSON('watchlist', DEFAULT_WATCHLIST);
      var settings = readJSON('settings', DEFAULT_SETTINGS);
      var lastSignals = readJSON('lastSignals', {});

      for (var i = 0; i < watchlist.length; i++) {
        var symbol = normalizeSymbol(watchlist[i]);
        try {
          var candles = await fetchKlines(symbol, settings.interval, settings.marketType, 260);
          if (candles.length < 50) continue;

          var ruleA = calculateRuleA(candles, settings);
          var ruleB = calculateRuleB(candles, settings);
          var combined = evaluateCombinedSignal(ruleA, ruleB, settings);
          var key = symbol + '_' + settings.interval + '_' + settings.marketType;

          if ((combined.signal === 'BUY' || combined.signal === 'SELL') && lastSignals[key] !== combined.signal) {
            lastSignals[key] = combined.signal;
            var price = candles[candles.length - 1].close;
            var label = combined.signal === 'BUY' ? '🚀 BUY' : '🔻 SELL';
            var displaySymbol = symbol.replace(/(USDT|BUSD|FDUSD)$/, '');

            CapacitorNotifications.schedule([
              {
                id: Math.floor(Math.random() * 2000000000),
                title: label + ' Alert: ' + displaySymbol + '/USDT',
                body: 'Price: $' + price + ' · ' + combined.reason + ' · ' + settings.interval,
              },
            ]);
          } else if (combined.signal === 'NEUTRAL' && lastSignals[key]) {
            lastSignals[key] = 'NEUTRAL';
          }
        } catch (innerErr) {
          console.error('background scan failed for ' + symbol + ': ' + innerErr);
        }
      }

      CapacitorKV.set('lastSignals', JSON.stringify(lastSignals));
      resolve();
    } catch (err) {
      reject(err);
    }
  })();
});
