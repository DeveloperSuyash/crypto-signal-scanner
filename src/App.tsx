import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Activity,
  AlertCircle,
  Bell,
  BellOff,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  Flame,
  Gauge,
  HelpCircle,
  Layers,
  LineChart,
  Menu,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';

import {
  AlertLog,
  Candle,
  CoinAnalysis,
  MarketType,
  PriceSource,
  Settings,
  SmoothingType,
  Timeframe,
} from './engine/types';
import { calculateRuleA, calculateRuleB, evaluateCombinedSignal } from './engine/indicators';
import { fetchBinanceKlines, fetchBinanceTicker24h, formatCoinDisplayName, normalizeSymbol } from './engine/binance';
import { playSignalSound } from './engine/audio';
import { IndicatorChart } from './components/IndicatorChart';
import { requestNotificationPermissions, sendNativeNotification } from './engine/notifications';

const DEFAULT_SETTINGS: Settings = {
  marketType: 'futures',
  interval: '5m',
  priceSource: 'hl2',
  volatilityPeriod: 40,
  volatilityMultiplier: 12,
  smoothingType: 'EMA',
  smoothingLength: 10,
  channelLength: 30,
  averageLength: 63,
  overboughtLevel1: 60,
  overboughtLevel2: 53,
  oversoldLevel1: -60,
  oversoldLevel2: -53,
  requireRuleB: true,
  confluenceWindow: 3,
  refreshIntervalSec: 15,
};

const DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BOMEUSDT', 'DOGEUSDT'];

const COIN_NAMES: Record<string, string> = {
  BTCUSDT: 'Bitcoin',
  ETHUSDT: 'Ethereum',
  SOLUSDT: 'Solana',
  BOMEUSDT: 'BOOK OF MEME',
  DOGEUSDT: 'Dogecoin',
  BNBUSDT: 'BNB',
  XRPUSDT: 'Ripple',
  PEPEUSDT: 'Pepe',
  SUIUSDT: 'Sui Network',
  NEARUSDT: 'NEAR Protocol',
  AVAXUSDT: 'Avalanche',
  LINKUSDT: 'Chainlink',
};

const loadValue = <T,>(key: string, fallback: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};

export default function App() {
  const [watchlist, setWatchlist] = useState<string[]>(() =>
    loadValue('crypto-signal-watchlist', DEFAULT_WATCHLIST)
  );
  const [settings, setSettings] = useState<Settings>(() =>
    loadValue('crypto-signal-settings', DEFAULT_SETTINGS)
  );
  const [alerts, setAlerts] = useState<AlertLog[]>(() =>
    loadValue('crypto-signal-alerts', [])
  );
  const [marketAnalyses, setMarketAnalyses] = useState<Record<string, CoinAnalysis>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'Dashboard' | 'History' | 'HowItWorks'>('Dashboard');
  const [isRunning, setIsRunning] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [toastAlert, setToastAlert] = useState<AlertLog | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Tracks previously notified signal state per coin to avoid repeat alert spam
  const lastEmittedSignal = useRef<Record<string, string>>({});

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('crypto-signal-watchlist', JSON.stringify(watchlist));
    localStorage.setItem('crypto-signal-settings', JSON.stringify(settings));
    localStorage.setItem('crypto-signal-alerts', JSON.stringify(alerts));
  }, [watchlist, settings, alerts]);

  // Update seconds counter
  useEffect(() => {
    requestNotificationPermissions();
    const timer = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastRefreshTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastRefreshTime]);


  // Trigger sound & toast alert on state transitions
  const handleSignalDetection = useCallback(
    (analysis: CoinAnalysis) => {
      const sig = analysis.combinedSignal.signal;
      const key = `${analysis.symbol}_${settings.interval}_${settings.marketType}`;
      const prevSig = lastEmittedSignal.current[key];

      if ((sig === 'BUY' || sig === 'SELL') && prevSig !== sig) {
        lastEmittedSignal.current[key] = sig;

        const newAlert: AlertLog = {
          id: `${Date.now()}_${analysis.symbol}`,
          symbol: analysis.symbol,
          signal: sig,
          price: analysis.price,
          timestamp: Date.now(),
          timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          timeframe: settings.interval,
          marketType: settings.marketType,
          ruleAReason: analysis.combinedSignal.ruleAStatus,
          ruleBReason: analysis.combinedSignal.ruleBStatus,
        };

        setAlerts((prev) => [newAlert, ...prev].slice(0, 100));
        setToastAlert(newAlert);
        playSignalSound(sig, soundEnabled);
        sendNativeNotification(
          `${sig === 'BUY' ? '🚀 BUY' : '🔻 SELL'} Alert: ${formatCoinDisplayName(analysis.symbol)}/USDT`,
          `Price: $${formatPrice(analysis.price)} · ${analysis.combinedSignal.ruleAStatus} · ${settings.interval}`
        );
      } else if (sig === 'NEUTRAL' && prevSig) {
        lastEmittedSignal.current[key] = 'NEUTRAL';
      }
    },
    [settings.interval, settings.marketType, soundEnabled]
  );


  // Market Scanner Engine
  const scanAllMarkets = useCallback(async () => {
    if (!isRunning || watchlist.length === 0) return;
    setIsRefreshing(true);

    try {
      const results: Record<string, CoinAnalysis> = {};

      await Promise.all(
        watchlist.map(async (symbol) => {
          try {
            const [candles, ticker] = await Promise.all([
              fetchBinanceKlines(symbol, settings.interval, settings.marketType, 260),
              fetchBinanceTicker24h(symbol, settings.marketType),
            ]);

            if (candles.length < 50) return;

            const ruleA = calculateRuleA(candles, settings);
            const ruleB = calculateRuleB(candles, settings);
            const combinedSignal = evaluateCombinedSignal(ruleA, ruleB, settings);

            const lastCandle = candles[candles.length - 1];
            const currentPrice = ticker?.lastPrice || lastCandle.close;
            const change24h = ticker?.priceChangePercent || 0;

            const analysis: CoinAnalysis = {
              symbol,
              name: COIN_NAMES[symbol] || formatCoinDisplayName(symbol),
              price: currentPrice,
              change24h,
              high24h: ticker?.highPrice || lastCandle.high,
              low24h: ticker?.lowPrice || lastCandle.low,
              volume24h: ticker?.volume || 0,
              candles,
              ruleA,
              ruleB,
              combinedSignal,
              lastUpdated: Date.now(),
            };

            results[symbol] = analysis;
            handleSignalDetection(analysis);
          } catch (err) {
            console.error(`Error scanning ${symbol}:`, err);
          }
        })
      );

      if (Object.keys(results).length > 0) {
        setMarketAnalyses((prev) => ({ ...prev, ...results }));
      }
      setLastRefreshTime(Date.now());
    } finally {
      setIsRefreshing(false);
    }
  }, [handleSignalDetection, isRunning, settings, watchlist]);

  // Initial and Periodic Fetch
  useEffect(() => {
    scanAllMarkets();
  }, [watchlist, settings.interval, settings.marketType]);

  useEffect(() => {
    if (!isRunning) return;
    const intervalMs = Math.max(10, settings.refreshIntervalSec || 15) * 1000;
    const timer = setInterval(() => {
      scanAllMarkets();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isRunning, scanAllMarkets, settings.refreshIntervalSec]);

  const [isAddingCoin, setIsAddingCoin] = useState(false);
  const [addCoinError, setAddCoinError] = useState<string | null>(null);

  // Add new coin to watchlist with instant Binance verification
  const handleAddCoin = async (e?: FormEvent, coinSymbolToQuickAdd?: string) => {
    if (e) e.preventDefault();
    const targetQuery = coinSymbolToQuickAdd || query;
    if (!targetQuery.trim()) return;

    const norm = normalizeSymbol(targetQuery);
    setAddCoinError(null);

    if (watchlist.includes(norm)) {
      setSelectedSymbol(norm);
      setQuery('');
      return;
    }

    setIsAddingCoin(true);

    try {
      // 1. Instantly verify and fetch candles for the new coin
      const [candles, ticker] = await Promise.all([
        fetchBinanceKlines(norm, settings.interval, settings.marketType, 260),
        fetchBinanceTicker24h(norm, settings.marketType),
      ]);

      if (!candles || candles.length < 20) {
        throw new Error(`Insufficient data for ${norm}`);
      }

      const ruleA = calculateRuleA(candles, settings);
      const ruleB = calculateRuleB(candles, settings);
      const combinedSignal = evaluateCombinedSignal(ruleA, ruleB, settings);

      const lastCandle = candles[candles.length - 1];
      const currentPrice = ticker?.lastPrice || lastCandle.close;
      const change24h = ticker?.priceChangePercent || 0;

      const analysis: CoinAnalysis = {
        symbol: norm,
        name: COIN_NAMES[norm] || formatCoinDisplayName(norm),
        price: currentPrice,
        change24h,
        high24h: ticker?.highPrice || lastCandle.high,
        low24h: ticker?.lowPrice || lastCandle.low,
        volume24h: ticker?.volume || 0,
        candles,
        ruleA,
        ruleB,
        combinedSignal,
        lastUpdated: Date.now(),
      };

      // Add to analyses and watchlist
      setMarketAnalyses((prev) => ({ ...prev, [norm]: analysis }));
      setWatchlist((prev) => [...prev, norm]);
      setSelectedSymbol(norm);
      setQuery('');
      handleSignalDetection(analysis);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Coin not found';
      setAddCoinError(`Could not find "${norm}" on Binance ${settings.marketType.toUpperCase()} market.`);
      setTimeout(() => setAddCoinError(null), 4000);
    } finally {
      setIsAddingCoin(false);
    }
  };


  const [coinToDelete, setCoinToDelete] = useState<string | null>(null);

  // Request coin removal (opens confirmation)
  const requestRemoveCoin = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCoinToDelete(symbol);
  };

  // Confirm removal
  const confirmRemoveCoin = () => {
    if (!coinToDelete) return;
    const symbol = coinToDelete;
    const updated = watchlist.filter((s) => s !== symbol);
    setWatchlist(updated);
    if (selectedSymbol === symbol && updated.length > 0) {
      setSelectedSymbol(updated[0]);
    }
    setCoinToDelete(null);
  };


  // Export CSV
  const handleExportCSV = () => {
    if (alerts.length === 0) return;
    const headers = 'ID,Symbol,Signal,Price,Time,Timeframe,Market,RuleA_Trend,RuleB_Momentum\n';
    const rows = alerts
      .map(
        (a) =>
          `"${a.id}","${a.symbol}","${a.signal}","${a.price}","${a.timeStr}","${a.timeframe}","${a.marketType}","${a.ruleAReason}","${a.ruleBReason}"`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `crypto_signals_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedCoinData = marketAnalyses[selectedSymbol];

  return (
    <div className="app-layout">
      {/* Background Ambient Glows */}
      <div className="ambient-glow glow-top" />
      <div className="ambient-glow glow-bottom" />

      {/* Top Navbar */}
      <header className="topbar">
        <div className="brand-section">
          <div className="brand-logo">
            <Radio size={22} className="pulse-icon text-cyan-400" />
          </div>
          <div className="brand-text">
            <div className="brand-title">
              CRYPTO<span>SIGNAL</span>
            </div>
            <div className="brand-sub">Algorithmic Confluence Engine</div>
          </div>
        </div>

        {/* Navigation Tabs (Desktop) */}
        <nav className={`nav-menu ${mobileMenuOpen ? 'open' : ''}`}>
          <button
            className={`nav-btn ${activeTab === 'Dashboard' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('Dashboard');
              setMobileMenuOpen(false);
            }}
          >
            <Activity size={16} /> Dashboard
          </button>
          <button
            className={`nav-btn ${activeTab === 'History' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('History');
              setMobileMenuOpen(false);
            }}
          >
            <Clock3 size={16} /> Signal History ({alerts.length})
          </button>
          <button
            className={`nav-btn ${activeTab === 'HowItWorks' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('HowItWorks');
              setMobileMenuOpen(false);
            }}
          >
            <CircleHelp size={16} /> Formula & Rules
          </button>

          {/* Mobile drawer quick controls */}
          <div className="mobile-drawer-controls">
            <div className="drawer-control-row">
              <span>Timeframe:</span>
              <select
                className="timeframe-select"
                value={settings.interval}
                onChange={(e) => setSettings((s) => ({ ...s, interval: e.target.value as Timeframe }))}
              >
                <option value="1m">1m Chart</option>
                <option value="3m">3m Chart</option>
                <option value="5m">5m Chart</option>
                <option value="15m">15m Chart</option>
                <option value="1h">1h Chart</option>
              </select>
            </div>
            <button
              className="drawer-settings-btn"
              onClick={() => {
                setShowSettings(true);
                setMobileMenuOpen(false);
              }}
            >
              <SlidersHorizontal size={16} /> Open Rules & Settings
            </button>
          </div>
        </nav>

        {/* Global Controls & Status */}
        <div className="topbar-actions">
          {/* Market Type Toggle (Spot vs Futures) */}
          <div className="market-type-switch">
            <button
              className={`type-btn ${settings.marketType === 'futures' ? 'active' : ''}`}
              onClick={() => setSettings((s) => ({ ...s, marketType: 'futures' }))}
              title="Binance USDT-M Futures"
            >
              Futures
            </button>
            <button
              className={`type-btn ${settings.marketType === 'spot' ? 'active' : ''}`}
              onClick={() => setSettings((s) => ({ ...s, marketType: 'spot' }))}
              title="Binance Spot Market"
            >
              Spot
            </button>
          </div>

          {/* Timeframe Selector (Hidden on small mobile, accessible in drawer) */}
          <select
            className="timeframe-select desktop-tf-select"
            value={settings.interval}
            onChange={(e) => setSettings((s) => ({ ...s, interval: e.target.value as Timeframe }))}
          >
            <option value="1m">1m</option>
            <option value="3m">3m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="30m">30m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
          </select>

          {/* Mute/Unmute */}
          <button
            className={`icon-action-btn ${soundEnabled ? 'sound-on' : 'sound-off'}`}
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playSignalSound('TEST', true);
            }}
            title={soundEnabled ? 'Sound alerts ON' : 'Sound alerts MUTED'}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {/* Rules / Settings Drawer Trigger */}
          <button
            className="settings-trigger-btn"
            onClick={() => setShowSettings(true)}
            title="Configure Indicator Parameters"
          >
            <SlidersHorizontal size={15} />
            <span className="settings-btn-label">Rules</span>
          </button>

          {/* Mobile hamburger */}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

      </header>

      {/* Main Container */}
      <main className="main-content">
        {activeTab === 'Dashboard' && (
          <div className="dashboard-grid">
            {/* Top Stat Banner */}
            <div className="hero-bar">
              <div className="hero-left">
                <div className="status-live-badge">
                  <span className={`live-dot ${isRunning ? 'pulse' : 'paused'}`} />
                  {isRunning ? `SCANNING EVERY ${settings.refreshIntervalSec}s` : 'SCANNER PAUSED'}
                </div>
                <h1 className="hero-title">
                  Real-time Dual Indicator <span>Confluence Scanner</span>
                </h1>
                <p className="hero-desc">
                  Tracking <b>Rule A</b> (Ratchet Volatility Trend) + <b>Rule B</b> (Normalized Momentum Exit) across{' '}
                  <b>{watchlist.length} markets</b> on Binance {settings.marketType.toUpperCase()}.
                </p>
              </div>

              <div className="hero-controls">
                <div className="refresh-status">
                  <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
                  <span>{isRefreshing ? 'Updating...' : `Updated ${secondsAgo}s ago`}</span>
                </div>
                <button
                  className={`pause-btn ${isRunning ? 'active' : 'paused'}`}
                  onClick={() => setIsRunning(!isRunning)}
                >
                  {isRunning ? (
                    <>
                      <Pause size={15} /> Pause Scanner
                    </>
                  ) : (
                    <>
                      <Play size={15} /> Resume Scanner
                    </>
                  )}
                </button>
                <button className="manual-sync-btn" onClick={() => scanAllMarkets()}>
                  <RefreshCw size={15} /> Sync Now
                </button>
              </div>
            </div>

            {/* Watchlist Section */}
            <section className="watchlist-section">
              <div className="section-head">
                <div className="section-title">
                  <Layers size={18} className="text-cyan-400" />
                  <h2>Active Watchlist ({watchlist.length})</h2>
                </div>

                <div className="add-market-wrap">
                  <form onSubmit={(e) => handleAddCoin(e)} className="add-market-form">
                    <div className="input-group">
                      <Plus size={16} className="text-slate-400" />
                      <input
                        type="text"
                        placeholder="Type symbol (e.g. PEPE, SUI, NEAR)"
                        value={query}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                        disabled={isAddingCoin}
                      />
                      <span className="pair-suffix">USDT</span>
                    </div>
                    <button type="submit" className="add-btn" disabled={isAddingCoin || !query.trim()}>
                      {isAddingCoin ? <RefreshCw size={14} className="spin" /> : 'Add Coin'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Error or warning banner for invalid coins */}
              {addCoinError && (
                <div className="add-coin-error-banner">
                  <AlertCircle size={15} />
                  <span>{addCoinError}</span>
                </div>
              )}

              {/* Popular Quick Add Chips */}
              <div className="quick-add-row">
                <span className="quick-add-title">Quick Add:</span>
                {['PEPEUSDT', 'SUIUSDT', 'NEARUSDT', 'AVAXUSDT', 'LINKUSDT', 'XRPUSDT', 'SHIBUSDT'].map((sym) => {
                  const isAdded = watchlist.includes(sym);
                  return (
                    <button
                      key={sym}
                      type="button"
                      className={`quick-chip ${isAdded ? 'added' : ''}`}
                      disabled={isAdded || isAddingCoin}
                      onClick={() => handleAddCoin(undefined, sym)}
                    >
                      {isAdded ? <Check size={12} /> : <Plus size={12} />}
                      {formatCoinDisplayName(sym)}
                    </button>
                  );
                })}
              </div>


              {/* Watchlist Cards */}
              <div className="cards-grid">
                {watchlist.map((symbol) => {
                  const data = marketAnalyses[symbol];
                  const isSelected = selectedSymbol === symbol;
                  const signal = data?.combinedSignal.signal || 'NEUTRAL';
                  const isBuy = signal === 'BUY';
                  const isSell = signal === 'SELL';
                  const isPositive = (data?.change24h || 0) >= 0;

                  return (
                    <div
                      key={symbol}
                      className={`market-card ${isSelected ? 'selected' : ''} ${
                        isBuy ? 'buy-border' : isSell ? 'sell-border' : ''
                      }`}
                      onClick={() => setSelectedSymbol(symbol)}
                    >
                      <div className="card-top">
                        <div className="symbol-info">
                          <div className="symbol-ticker">
                            {formatCoinDisplayName(symbol)}
                            <span className="quote">/USDT</span>
                          </div>
                          <div className="symbol-name">{data?.name || symbol}</div>
                        </div>

                        {/* Signal Pill */}
                        <div
                          className={`signal-badge ${
                            isBuy ? 'badge-buy' : isSell ? 'badge-sell' : 'badge-watch'
                          }`}
                        >
                          {isBuy ? '🔥 BUY SIGNAL' : isSell ? '⚠️ SELL SIGNAL' : 'WATCHING'}
                        </div>

                        {/* Remove with Confirmation */}
                        <button
                          className="remove-btn"
                          onClick={(e) => requestRemoveCoin(symbol, e)}
                          title="Remove from watchlist"
                        >
                          <X size={14} />
                        </button>

                      </div>

                      {/* Price Row */}
                      <div className="card-price-row">
                        <div className="price-display">
                          ${data ? formatPrice(data.price) : '---'}
                        </div>
                        <div className={`change-pill ${isPositive ? 'positive' : 'negative'}`}>
                          {isPositive ? '+' : ''}
                          {data ? data.change24h.toFixed(2) : '0.00'}%
                        </div>
                      </div>

                      {/* Indicator Status Micro-Bars */}
                      <div className="card-indicators">
                        <div className="indicator-col">
                          <span className="ind-label">Rule A (Trend)</span>
                          <span
                            className={`ind-value ${
                              data?.ruleA.currentState === 'UP' ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {data?.ruleA.currentState === 'UP' ? '▲ UPTREND' : '▼ DOWNTREND'}
                          </span>
                        </div>
                        <div className="indicator-col">
                          <span className="ind-label">Rule B (Mom)</span>
                          <span
                            className={`ind-value ${
                              (data?.ruleB.currentMomentum || 0) >= 0
                                ? 'text-purple-400'
                                : 'text-indigo-400'
                            }`}
                          >
                            {data ? `${data.ruleB.currentMomentum.toFixed(1)}` : '0.0'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Detailed Selected Market Workspace */}
            {selectedCoinData ? (
              <section className="detail-workspace">
                <div className="workspace-header">
                  <div className="ws-coin-info">
                    <div className="ws-title-row">
                      <h2>{selectedCoinData.name}</h2>
                      <span className="ws-symbol">{selectedCoinData.symbol}</span>
                      <span className="ws-market-tag">{settings.marketType.toUpperCase()}</span>
                      <span className="ws-tf-tag">{settings.interval}</span>
                    </div>
                    <div className="ws-price-row">
                      <span className="ws-current-price">
                        ${formatPrice(selectedCoinData.price)}
                      </span>
                      <span
                        className={`ws-change ${
                          selectedCoinData.change24h >= 0 ? 'positive' : 'negative'
                        }`}
                      >
                        {selectedCoinData.change24h >= 0 ? '+' : ''}
                        {selectedCoinData.change24h.toFixed(2)}% (24h)
                      </span>
                    </div>
                  </div>

                  {/* Signal Box */}
                  <div className="ws-signal-box">
                    <div className="signal-box-inner">
                      <span className="sig-box-title">CONFLUENCE STATUS</span>
                      <div
                        className={`sig-box-pill ${
                          selectedCoinData.combinedSignal.signal === 'BUY'
                            ? 'buy'
                            : selectedCoinData.combinedSignal.signal === 'SELL'
                            ? 'sell'
                            : 'neutral'
                        }`}
                      >
                        {selectedCoinData.combinedSignal.signal === 'BUY' && <TrendingUp size={20} />}
                        {selectedCoinData.combinedSignal.signal === 'SELL' && <TrendingDown size={20} />}
                        {selectedCoinData.combinedSignal.signal === 'NEUTRAL' && <Activity size={20} />}
                        <span>
                          {selectedCoinData.combinedSignal.signal === 'BUY'
                            ? 'BUY ALERT ACTIVE'
                            : selectedCoinData.combinedSignal.signal === 'SELL'
                            ? 'SELL ALERT ACTIVE'
                            : 'NO ACTIVE SIGNAL'}
                        </span>
                      </div>
                      <small className="sig-reason-text">
                        {selectedCoinData.combinedSignal.reason}
                      </small>
                    </div>
                  </div>
                </div>

                {/* Main Interactive Chart with Candlesticks + Indicator Overlays */}
                <div className="chart-panel">
                  <IndicatorChart coin={selectedCoinData} settings={settings} />
                </div>

                {/* Indicators Breakdown Panels */}
                <div className="indicators-breakdown-grid">
                  {/* Rule A Detail Card */}
                  <div className="breakdown-card">
                    <div className="bc-header">
                      <div className="bc-title">
                        <TrendingUp size={18} className="text-emerald-400" />
                        <h3>Rule A — Trend Signal</h3>
                      </div>
                      <span
                        className={`bc-state-badge ${
                          selectedCoinData.ruleA.currentState === 'UP' ? 'up' : 'down'
                        }`}
                      >
                        {selectedCoinData.ruleA.currentState === 'UP' ? 'UPTREND' : 'DOWNTREND'}
                      </span>
                    </div>
                    <div className="bc-stats">
                      <div className="bc-stat-row">
                        <span>Base Line (EMA {settings.smoothingLength}):</span>
                        <b>${formatPrice(selectedCoinData.ruleA.currentBase)}</b>
                      </div>
                      <div className="bc-stat-row">
                        <span>Upper Ratchet:</span>
                        <b className="text-rose-400">
                          ${formatPrice(selectedCoinData.ruleA.currentUpper)}
                        </b>
                      </div>
                      <div className="bc-stat-row">
                        <span>Lower Ratchet:</span>
                        <b className="text-emerald-400">
                          ${formatPrice(selectedCoinData.ruleA.currentLower)}
                        </b>
                      </div>
                      <div className="bc-stat-row">
                        <span>Last State Flip:</span>
                        <b>
                          {selectedCoinData.ruleA.flippedCandlesAgo === 0
                            ? 'Current Candle'
                            : `${selectedCoinData.ruleA.flippedCandlesAgo} candles ago`}
                        </b>
                      </div>
                    </div>
                  </div>

                  {/* Rule B Detail Card */}
                  <div className="breakdown-card">
                    <div className="bc-header">
                      <div className="bc-title">
                        <Gauge size={18} className="text-purple-400" />
                        <h3>Rule B — Momentum Signal</h3>
                      </div>
                      <span
                        className={`bc-zone-badge ${
                          selectedCoinData.ruleB.currentZone === 'OVERSOLD'
                            ? 'oversold'
                            : selectedCoinData.ruleB.currentZone === 'OVERBOUGHT'
                            ? 'overbought'
                            : 'in-range'
                        }`}
                      >
                        {selectedCoinData.ruleB.currentZone}
                      </span>
                    </div>
                    <div className="bc-stats">
                      <div className="bc-stat-row">
                        <span>Momentum Reading:</span>
                        <b className="text-purple-300">
                          {selectedCoinData.ruleB.currentMomentum.toFixed(2)}
                        </b>
                      </div>
                      <div className="bc-stat-row">
                        <span>Overbought Threshold:</span>
                        <b className="text-rose-400">+{settings.overboughtLevel1}</b>
                      </div>
                      <div className="bc-stat-row">
                        <span>Oversold Threshold:</span>
                        <b className="text-emerald-400">{settings.oversoldLevel1}</b>
                      </div>
                      <div className="bc-stat-row">
                        <span>Confirmation Mode:</span>
                        <b>{settings.requireRuleB ? 'Required (On)' : 'Bypassed (Off)'}</b>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <div className="loading-state">
                <RefreshCw size={24} className="spin text-cyan-400" />
                <p>Loading real-time candlestick data from Binance...</p>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'History' && (
          <section className="history-page">
            <div className="page-header">
              <div>
                <span className="eyebrow">
                  <Clock3 size={15} /> SIGNAL EVENT LOG
                </span>
                <h2>Confluence Alert History</h2>
                <p>All historical BUY and SELL signals captured while this scanner is open.</p>
              </div>
              <button
                className="export-btn"
                onClick={handleExportCSV}
                disabled={alerts.length === 0}
              >
                <Download size={16} /> Export to CSV
              </button>
            </div>

            {alerts.length === 0 ? (
              <div className="empty-history-box">
                <BellOff size={32} className="text-slate-500" />
                <h3>No signals logged yet</h3>
                <p>Signals will automatically populate here whenever both rules trigger.</p>
              </div>
            ) : (
              <div className="history-table-wrapper">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Market</th>
                      <th>Signal</th>
                      <th>Price</th>
                      <th>Timeframe</th>
                      <th>Rule A (Trend)</th>
                      <th>Rule B (Momentum)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((item) => (
                      <tr key={item.id}>
                        <td className="time-cell">{item.timeStr}</td>
                        <td className="symbol-cell">
                          <b>{formatCoinDisplayName(item.symbol)}</b>
                          <small>/{item.symbol.endsWith('USDT') ? 'USDT' : ''}</small>
                        </td>
                        <td>
                          <span
                            className={`sig-pill ${
                              item.signal === 'BUY' ? 'sig-buy' : 'sig-sell'
                            }`}
                          >
                            {item.signal === 'BUY' ? '▲ BUY' : '▼ SELL'}
                          </span>
                        </td>
                        <td className="price-cell">${formatPrice(item.price)}</td>
                        <td>{item.timeframe}</td>
                        <td>{item.ruleAReason}</td>
                        <td>{item.ruleBReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* How It Works Tab */}
        {activeTab === 'HowItWorks' && (
          <section className="how-it-works-page">
            <div className="page-header">
              <span className="eyebrow">
                <CircleHelp size={15} /> TRADING ALGORITHM
              </span>
              <h2>How the Dual Signal Scanner Works</h2>
              <p>
                Eliminates false breakouts by requiring both price action direction and oscillator
                exhaustion to align simultaneously.
              </p>
            </div>

            <div className="algorithm-cards">
              <div className="algo-card">
                <div className="algo-num">01</div>
                <div className="algo-icon trend">
                  <TrendingUp size={24} />
                </div>
                <h3>Rule A — Trend Signal (Ratchet Envelope)</h3>
                <p>
                  Measures true price volatility using <b>Wilder's Smoothed ATR (40 periods)</b>{' '}
                  around an <b>EMA (10) Base trend line</b>. Dynamic Upper and Lower envelope bands
                  ratchet one-way to lock in trends until a decisive breakout flip occurs.
                </p>
                <div className="formula-box">
                  <code>Base = EMA(Price, 10)</code>
                  <code>Volatility = WilderATR(40)</code>
                  <code>Upper = Base + (12 × Volatility)</code>
                  <code>Lower = Base - (12 × Volatility)</code>
                </div>
              </div>

              <div className="algo-card">
                <div className="algo-num">02</div>
                <div className="algo-icon mom">
                  <Gauge size={24} />
                </div>
                <h3>Rule B — Momentum Signal (Normalized Oscillator)</h3>
                <p>
                  Calculates typical price deviation against a 30-period channel, normalized by
                  mean absolute deviation and smoothed via 63-period EMA. Identifies extreme
                  overbought (+60) and oversold (-60) zones.
                </p>
                <div className="formula-box">
                  <code>TypicalPrice = (High + Low + Close) / 3</code>
                  <code>Smoothed = EMA(TypicalPrice, 30)</code>
                  <code>Raw = (Typical - Smoothed) / (0.015 × AvgDist)</code>
                  <code>Momentum = EMA(Raw, 63)</code>
                </div>
              </div>

              <div className="algo-card">
                <div className="algo-num">03</div>
                <div className="algo-icon conf">
                  <Zap size={24} />
                </div>
                <h3>Smart Confluence Alert</h3>
                <p>
                  A <b>BUY Alert</b> fires when Rule A flips to UPTREND while Rule B is oversold or
                  rebounding. A <b>SELL Alert</b> fires when Rule A flips to DOWNTREND while Rule B
                  is overbought.
                </p>
                <div className="formula-box">
                  <code>BUY = Rule A UP + Rule B Oversold</code>
                  <code>SELL = Rule A DOWN + Rule B Overbought</code>
                  <code>Tolerance = 1 to 3 Candles Window</code>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Floating Toast Notification for Real-Time Signals */}
      {toastAlert && (
        <div className={`toast-notification ${toastAlert.signal === 'BUY' ? 'toast-buy' : 'toast-sell'}`}>
          <div className="toast-icon">
            {toastAlert.signal === 'BUY' ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
          </div>
          <div className="toast-content">
            <div className="toast-head">
              <span className="toast-tag">
                {toastAlert.signal === 'BUY' ? '🚀 BUY SIGNAL' : '🔻 SELL SIGNAL'}
              </span>
              <span className="toast-time">{toastAlert.timeStr}</span>
            </div>
            <div className="toast-body">
              <b>{formatCoinDisplayName(toastAlert.symbol)}/USDT</b> triggered at{' '}
              <b>${formatPrice(toastAlert.price)}</b>
            </div>
            <small className="toast-sub">
              {toastAlert.ruleAReason} · {toastAlert.timeframe}
            </small>
          </div>
          <button className="toast-close" onClick={() => setToastAlert(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Remove Coin Confirmation Modal */}
      {coinToDelete && (
        <div className="modal-backdrop" onClick={() => setCoinToDelete(null)}>
          <div className="confirm-delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon-box">
              <Trash2 size={24} className="text-rose-400" />
            </div>
            <h3>Remove Coin from Watchlist?</h3>
            <p>
              Are you sure you want to remove <b>{COIN_NAMES[coinToDelete] || formatCoinDisplayName(coinToDelete)} ({formatCoinDisplayName(coinToDelete)}/USDT)</b> from your active scanning watchlist?
            </p>
            <div className="confirm-actions">
              <button className="confirm-cancel-btn" onClick={() => setCoinToDelete(null)}>
                Cancel
              </button>
              <button className="confirm-delete-btn" onClick={confirmRemoveCoin}>
                <Trash2 size={16} /> Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal Drawer */}
      {showSettings && (

        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <div className="modal-title">
                <SlidersHorizontal size={20} className="text-cyan-400" />
                <div>
                  <h3>Scanner Engine Configuration</h3>
                  <p>Fine-tune mathematical parameters for Rule A & Rule B</p>
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowSettings(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="settings-body">
              {/* General Settings */}
              <div className="settings-group">
                <h4>General & Market Settings</h4>
                <div className="settings-fields-grid">
                  <label className="field-item">
                    <span>Market Data Source</span>
                    <select
                      value={settings.marketType}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, marketType: e.target.value as MarketType }))
                      }
                    >
                      <option value="futures">Binance Futures (fapi.binance.com)</option>
                      <option value="spot">Binance Spot (api.binance.com)</option>
                    </select>
                  </label>

                  <label className="field-item">
                    <span>Default Timeframe</span>
                    <select
                      value={settings.interval}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, interval: e.target.value as Timeframe }))
                      }
                    >
                      <option value="1m">1 minute</option>
                      <option value="3m">3 minutes</option>
                      <option value="5m">5 minutes (Recommended)</option>
                      <option value="15m">15 minutes</option>
                      <option value="1h">1 hour</option>
                    </select>
                  </label>

                  <label className="field-item">
                    <span>Auto-Refresh Interval (Seconds)</span>
                    <input
                      type="number"
                      min={5}
                      max={60}
                      value={settings.refreshIntervalSec}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, refreshIntervalSec: Number(e.target.value) }))
                      }
                    />
                  </label>

                  <label className="field-item">
                    <span>Confluence Candle Window</span>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={settings.confluenceWindow}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, confluenceWindow: Number(e.target.value) }))
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Rule A Parameters */}
              <div className="settings-group">
                <h4>Rule A: Trend Signal (Wilder's ATR Envelope)</h4>
                <div className="settings-fields-grid">
                  <label className="field-item">
                    <span>Price Source</span>
                    <select
                      value={settings.priceSource}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, priceSource: e.target.value as PriceSource }))
                      }
                    >
                      <option value="hl2">HL2 ((High + Low) / 2)</option>
                      <option value="close">Close Price</option>
                      <option value="ohlc4">OHLC4 ((O+H+L+C) / 4)</option>
                      <option value="hlc3">HLC3 ((H+L+C) / 3)</option>
                    </select>
                  </label>

                  <label className="field-item">
                    <span>Volatility Period (Wilder ATR)</span>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      value={settings.volatilityPeriod}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, volatilityPeriod: Number(e.target.value) }))
                      }
                    />
                  </label>

                  <label className="field-item">
                    <span>Volatility Multiplier</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={settings.volatilityMultiplier}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, volatilityMultiplier: Number(e.target.value) }))
                      }
                    />
                  </label>

                  <label className="field-item">
                    <span>Base Smoothing Type</span>
                    <select
                      value={settings.smoothingType}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, smoothingType: e.target.value as SmoothingType }))
                      }
                    >
                      <option value="EMA">EMA (Exponential)</option>
                      <option value="SMA">SMA (Simple)</option>
                    </select>
                  </label>

                  <label className="field-item">
                    <span>Base Smoothing Length</span>
                    <input
                      type="number"
                      min={2}
                      max={50}
                      value={settings.smoothingLength}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, smoothingLength: Number(e.target.value) }))
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Rule B Parameters */}
              <div className="settings-group">
                <h4>Rule B: Momentum Signal (Oscillator)</h4>
                <div className="settings-fields-grid">
                  <label className="field-item">
                    <span>Channel Length</span>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      value={settings.channelLength}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, channelLength: Number(e.target.value) }))
                      }
                    />
                  </label>

                  <label className="field-item">
                    <span>Average Length</span>
                    <input
                      type="number"
                      min={5}
                      max={200}
                      value={settings.averageLength}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, averageLength: Number(e.target.value) }))
                      }
                    />
                  </label>

                  <label className="field-item">
                    <span>Overbought Level (+OB)</span>
                    <input
                      type="number"
                      value={settings.overboughtLevel1}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, overboughtLevel1: Number(e.target.value) }))
                      }
                    />
                  </label>

                  <label className="field-item">
                    <span>Oversold Level (-OS)</span>
                    <input
                      type="number"
                      value={settings.oversoldLevel1}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, oversoldLevel1: Number(e.target.value) }))
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Confirmation Toggle */}
              <div className="settings-toggle-box">
                <div className="toggle-left">
                  <b>Require Rule B Confirmation</b>
                  <p>When enabled, BUY/SELL signals only trigger when both Rule A & Rule B agree.</p>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${settings.requireRuleB ? 'on' : 'off'}`}
                  onClick={() =>
                    setSettings((s) => ({ ...s, requireRuleB: !s.requireRuleB }))
                  }
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="reset-btn"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
              >
                Reset Defaults
              </button>
              <button
                className="save-btn"
                onClick={() => {
                  setShowSettings(false);
                  scanAllMarkets();
                }}
              >
                Apply & Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatPrice(val: number): string {
  if (isNaN(val)) return '0.00';
  if (val >= 1000) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (val >= 1) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return val.toFixed(6);
}
