import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PersonalPortfolio = require('../personal-portfolio.js');

const defaults = PersonalPortfolio.normalizeProfile();
assert.equal(defaults.broker, 'Midas');
assert.equal(defaults.buyCostPct, 0);
assert.equal(defaults.sellCostPct, 0);
assert.equal(defaults.returnView, 'net');

const fillKey = PersonalPortfolio.fillKey('asels', '2026-07-13');
assert.equal(fillKey, 'ASELS|2026-07-13');

const actualFillProfile = PersonalPortfolio.normalizeProfile({
  broker: 'Midas',
  buyCostPct: 0,
  sellCostPct: 0,
  returnView: 'net',
  fills: {
    [fillKey]: {
      ticker: 'ASELS',
      selectionDate: '2026-07-13',
      actualEntryFill: 355,
    },
  },
});
const actual = PersonalPortfolio.positionReturn(actualFillProfile, {
  ticker: 'ASELS',
  selectionDate: '2026-07-13',
  modelEntryPrice: 370,
  modelExitPrice: 370,
});
assert.equal(actual.entryPrice, 355);
assert.equal(actual.entrySource, 'actual');
assert.ok(Math.abs(actual.returnFraction - (370 / 355 - 1)) < 1e-12);

const gross = PersonalPortfolio.calculateTradeReturn({
  entryPrice: 100,
  exitPrice: 110,
  buyCostPct: 0.2,
  sellCostPct: 0.2,
  view: 'gross',
});
const net = PersonalPortfolio.calculateTradeReturn({
  entryPrice: 100,
  exitPrice: 110,
  buyCostPct: 0.2,
  sellCostPct: 0.2,
  view: 'net',
});
assert.ok(Math.abs(gross - 0.1) < 1e-12);
assert.ok(net < gross);

const realizedProfile = PersonalPortfolio.normalizeProfile({
  buyCostPct: 0.1,
  sellCostPct: 0.2,
  fills: {
    [fillKey]: {
      ticker: 'ASELS',
      selectionDate: '2026-07-13',
      actualEntryFill: 355,
      actualExitFill: 365,
    },
  },
});
const realized = PersonalPortfolio.positionReturn(realizedProfile, {
  ticker: 'ASELS',
  selectionDate: '2026-07-13',
  modelEntryPrice: 370,
  modelExitPrice: 360,
});
assert.equal(realized.entryPrice, 355);
assert.equal(realized.exitPrice, 365);
assert.equal(realized.entrySource, 'actual');
assert.equal(realized.exitSource, 'actual');
assert.ok(realized.returnFraction < 365 / 355 - 1);

const sanitized = PersonalPortfolio.normalizeProfile({
  buyCostPct: -1,
  sellCostPct: 'not-a-number',
  fills: { broken: { actualEntryFill: -5 } },
});
assert.equal(sanitized.buyCostPct, 0);
assert.equal(sanitized.sellCostPct, 0);
assert.deepEqual(sanitized.fills, {});

console.log('Personal portfolio checks passed.');
