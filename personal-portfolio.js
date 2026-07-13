/**
 * Personal execution profile and return math.
 *
 * Model reference prices remain immutable public data. Actual fills and broker
 * costs are private browser data layered over those references.
 */
(function exposePersonalPortfolio(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PersonalPortfolio = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildApi() {
  'use strict';

  const PROFILE_VERSION = 1;
  const DEFAULT_PROFILE = Object.freeze({
    version: PROFILE_VERSION,
    broker: 'Midas',
    buyCostPct: 0,
    sellCostPct: 0,
    returnView: 'net',
    fills: {},
  });

  function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeCost(value) {
    return Math.min(100, Math.max(0, finite(value, 0)));
  }

  function fillKey(ticker, selectionDate) {
    const normalizedTicker = String(ticker || '').trim().toUpperCase();
    const normalizedDate = String(selectionDate || '').trim();
    if (!normalizedTicker || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return '';
    return `${normalizedTicker}|${normalizedDate}`;
  }

  function normalizeFill(raw, key = '') {
    if (!raw || typeof raw !== 'object') return null;
    const ticker = String(raw.ticker || key.split('|')[0] || '').trim().toUpperCase();
    const selectionDate = String(raw.selectionDate || key.split('|')[1] || '').trim();
    const actualEntryFill = finite(raw.actualEntryFill, null);
    const actualExitFill = finite(raw.actualExitFill, null);
    if (!fillKey(ticker, selectionDate) || !(actualEntryFill > 0)) return null;
    return {
      ticker,
      selectionDate,
      actualEntryFill,
      actualExitFill: actualExitFill > 0 ? actualExitFill : null,
      updatedAt: String(raw.updatedAt || ''),
    };
  }

  function normalizeProfile(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const fills = {};
    if (source.fills && typeof source.fills === 'object') {
      Object.entries(source.fills).forEach(([key, value]) => {
        const normalized = normalizeFill(value, key);
        if (normalized) fills[fillKey(normalized.ticker, normalized.selectionDate)] = normalized;
      });
    }
    return {
      version: PROFILE_VERSION,
      broker: String(source.broker || DEFAULT_PROFILE.broker).trim() || DEFAULT_PROFILE.broker,
      buyCostPct: normalizeCost(source.buyCostPct),
      sellCostPct: normalizeCost(source.sellCostPct),
      returnView: source.returnView === 'gross' ? 'gross' : 'net',
      fills,
    };
  }

  function getFill(profile, ticker, selectionDate) {
    const key = fillKey(ticker, selectionDate);
    if (!key) return null;
    return normalizeProfile(profile).fills[key] || null;
  }

  function calculateTradeReturn({
    entryPrice,
    exitPrice,
    buyCostPct = 0,
    sellCostPct = 0,
    view = 'net',
    includeBuyCost = true,
    includeSellCost = true,
  }) {
    const entry = finite(entryPrice, null);
    const exit = finite(exitPrice, null);
    if (!(entry > 0) || !(exit > 0)) return null;
    if (view === 'gross') return exit / entry - 1;

    const buyRate = includeBuyCost ? normalizeCost(buyCostPct) / 100 : 0;
    const sellRate = includeSellCost ? normalizeCost(sellCostPct) / 100 : 0;
    const cashOut = entry * (1 + buyRate);
    const cashIn = exit * (1 - sellRate);
    return cashIn / cashOut - 1;
  }

  function positionReturn(profile, {
    ticker,
    selectionDate,
    modelEntryPrice,
    modelExitPrice,
    includeBuyCost = true,
    includeSellCost = true,
  }) {
    const normalized = normalizeProfile(profile);
    const fill = getFill(normalized, ticker, selectionDate);
    const entryPrice = fill?.actualEntryFill || finite(modelEntryPrice, null);
    const exitPrice = fill?.actualExitFill || finite(modelExitPrice, null);
    const returnFraction = calculateTradeReturn({
      entryPrice,
      exitPrice,
      buyCostPct: normalized.buyCostPct,
      sellCostPct: normalized.sellCostPct,
      view: normalized.returnView,
      includeBuyCost,
      includeSellCost,
    });
    return {
      entryPrice,
      exitPrice,
      returnFraction,
      entrySource: fill?.actualEntryFill ? 'actual' : 'model',
      exitSource: fill?.actualExitFill ? 'actual' : 'model',
    };
  }

  return {
    PROFILE_VERSION,
    DEFAULT_PROFILE,
    fillKey,
    normalizeProfile,
    getFill,
    calculateTradeReturn,
    positionReturn,
  };
}));
