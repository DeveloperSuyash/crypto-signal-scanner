import React, { useState } from 'react';
import { CoinAnalysis, Settings } from '../engine/types';

interface IndicatorChartProps {
  coin: CoinAnalysis;
  settings: Settings;
}

export function IndicatorChart({ coin, settings }: IndicatorChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const candles = coin.candles;
  const len = candles.length;
  if (len < 5) {
    return <div className="chart-empty">Gathering candle data...</div>;
  }

  // Slice last 60 candles for detailed high-definition rendering
  const displayCount = Math.min(60, len);
  const startIdx = len - displayCount;

  const displayCandles = candles.slice(startIdx);
  const displayBase = coin.ruleA.base.slice(startIdx);
  const displayUpper = coin.ruleA.upperBand.slice(startIdx);
  const displayLower = coin.ruleA.lowerBand.slice(startIdx);
  const displayMom = coin.ruleB.momentum.slice(startIdx);

  // Calculate Price Chart Range (including indicator bands)
  const allPriceVals: number[] = [];
  displayCandles.forEach((c) => {
    allPriceVals.push(c.high, c.low, c.close);
  });
  displayBase.forEach((b) => b && allPriceVals.push(b));
  displayUpper.forEach((u) => u && allPriceVals.push(u));
  displayLower.forEach((l) => l && allPriceVals.push(l));

  const minPrice = Math.min(...allPriceVals);
  const maxPrice = Math.max(...allPriceVals);
  const priceRange = maxPrice - minPrice || 1;

  // Viewport dimensions
  const width = 800;
  const priceHeight = 220;
  const momHeight = 90;
  const padX = 20;
  const padY = 15;

  const getX = (i: number) => padX + (i / (displayCount - 1)) * (width - padX * 2);
  const getYPrice = (val: number) =>
    priceHeight - padY - ((val - minPrice) / priceRange) * (priceHeight - padY * 2);

  // SVG Paths for Rule A
  const basePath = displayBase
    .map((val, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getYPrice(val)}`)
    .join(' ');
  const upperPath = displayUpper
    .map((val, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getYPrice(val)}`)
    .join(' ');
  const lowerPath = displayLower
    .map((val, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getYPrice(val)}`)
    .join(' ');

  // Momentum Range (-100 to +100 normalized clamp or dynamic)
  const momVals = displayMom.filter((v) => !isNaN(v));
  const minMom = Math.min(-75, ...momVals);
  const maxMom = Math.max(75, ...momVals);
  const momRange = maxMom - minMom || 1;

  const getYMom = (val: number) =>
    momHeight - 10 - ((val - minMom) / momRange) * (momHeight - 20);

  const momPath = displayMom
    .map((val, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getYMom(val)}`)
    .join(' ');

  const activeIdx = hoverIndex !== null ? hoverIndex : displayCount - 1;
  const activeCandle = displayCandles[activeIdx] || displayCandles[displayCandles.length - 1];
  const activeBase = displayBase[activeIdx] || 0;
  const activeUpper = displayUpper[activeIdx] || 0;
  const activeLower = displayLower[activeIdx] || 0;
  const activeMom = displayMom[activeIdx] || 0;

  return (
    <div className="indicator-chart-wrapper">
      {/* HUD Info Bar */}
      <div className="chart-hud">
        <div className="hud-candle">
          <span>O: <b>${formatNumber(activeCandle.open)}</b></span>
          <span>H: <b>${formatNumber(activeCandle.high)}</b></span>
          <span>L: <b>${formatNumber(activeCandle.low)}</b></span>
          <span>C: <b>${formatNumber(activeCandle.close)}</b></span>
        </div>
        <div className="hud-indicators">
          <span className="hud-item base">
            <i /> Base (EMA {settings.smoothingLength}): ${formatNumber(activeBase)}
          </span>
          <span className="hud-item upper">
            <i /> Upper Ratchet: ${formatNumber(activeUpper)}
          </span>
          <span className="hud-item lower">
            <i /> Lower Ratchet: ${formatNumber(activeLower)}
          </span>
          <span className="hud-item momentum">
            <i /> Momentum: <b>{activeMom.toFixed(1)}</b>
          </span>
        </div>
      </div>

      {/* Main SVG Area */}
      <div className="chart-svg-container">
        {/* Main Price & Rule A Chart */}
        <svg
          viewBox={`0 0 ${width} ${priceHeight}`}
          className="chart-svg price-svg"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            const idx = Math.min(
              displayCount - 1,
              Math.max(0, Math.round(((relX - padX) / (rect.width - padX * 2)) * (displayCount - 1)))
            );
            setHoverIndex(idx);
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Grid lines */}
          <line x1={padX} y1={priceHeight / 4} x2={width - padX} y2={priceHeight / 4} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
          <line x1={padX} y1={priceHeight / 2} x2={width - padX} y2={priceHeight / 2} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
          <line x1={padX} y1={(priceHeight * 3) / 4} x2={width - padX} y2={(priceHeight * 3) / 4} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />

          {/* Ratchet Channels Area */}
          <path d={upperPath} fill="none" stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.85" />
          <path d={lowerPath} fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.85" />
          <path d={basePath} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />

          {/* Candlesticks */}
          {displayCandles.map((c, i) => {
            const x = getX(i);
            const isGreen = c.close >= c.open;
            const color = isGreen ? '#10b981' : '#f43f5e';
            const yHigh = getYPrice(c.high);
            const yLow = getYPrice(c.low);
            const yOpen = getYPrice(c.open);
            const yClose = getYPrice(c.close);
            const topBody = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));
            const candleWidth = Math.max(3, (width - padX * 2) / displayCount * 0.65);

            return (
              <g key={c.time} className="candle-group">
                {/* Wick */}
                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth="1.2" />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={topBody}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  rx="1"
                />
              </g>
            );
          })}

          {/* Crosshair Cursor */}
          {hoverIndex !== null && (
            <line
              x1={getX(hoverIndex)}
              y1={0}
              x2={getX(hoverIndex)}
              y2={priceHeight}
              stroke="rgba(255,255,255,0.3)"
              strokeDasharray="2 2"
            />
          )}
        </svg>

        {/* Momentum Indicator Sub-chart (Rule B) */}
        <div className="subchart-label">
          <span>RULE B: MOMENTUM OSCILLATOR (Overbought +60 / Oversold -60)</span>
          <span className={activeMom >= 0 ? 'positive' : 'negative'}>{activeMom.toFixed(1)}</span>
        </div>
        <svg viewBox={`0 0 ${width} ${momHeight}`} className="chart-svg mom-svg">
          {/* Overbought line (+60) */}
          <line
            x1={padX}
            y1={getYMom(settings.overboughtLevel1)}
            x2={width - padX}
            y2={getYMom(settings.overboughtLevel1)}
            stroke="#f43f5e"
            strokeDasharray="3 3"
            strokeWidth="1"
            opacity="0.6"
          />
          <text x={width - padX - 55} y={getYMom(settings.overboughtLevel1) - 3} fill="#f43f5e" fontSize="9" opacity="0.8">
            +{settings.overboughtLevel1} OB
          </text>

          {/* Zero baseline */}
          <line
            x1={padX}
            y1={getYMom(0)}
            x2={width - padX}
            y2={getYMom(0)}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
          />

          {/* Oversold line (-60) */}
          <line
            x1={padX}
            y1={getYMom(settings.oversoldLevel1)}
            x2={width - padX}
            y2={getYMom(settings.oversoldLevel1)}
            stroke="#10b981"
            strokeDasharray="3 3"
            strokeWidth="1"
            opacity="0.6"
          />
          <text x={width - padX - 55} y={getYMom(settings.oversoldLevel1) + 10} fill="#10b981" fontSize="9" opacity="0.8">
            {settings.oversoldLevel1} OS
          </text>

          {/* Momentum Curve */}
          <path d={momPath} fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" />

          {/* Hover indicator dot */}
          {hoverIndex !== null && (
            <circle
              cx={getX(hoverIndex)}
              cy={getYMom(displayMom[hoverIndex] || 0)}
              r="3.5"
              fill="#c084fc"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

function formatNumber(val: number): string {
  if (isNaN(val)) return '0.00';
  if (val >= 1000) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (val >= 1) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return val.toFixed(6);
}
