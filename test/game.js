'use strict';
/* ============================================================
 * Game.js 纯函数单测：层级槽模型（空槽/暗轨）+ trackPath（事故调查回放）
 * ============================================================ */
const assert = require('assert');
const Game = require('../public/game.js');

// 空槽 = 恒等置换；暗轨真实参与置换
const levels = [
  null,                       // 槽0：空白（工务组待命）
  { pair: 0, hidden: false }, // 槽1：显手 0↔1
  { pair: 1, hidden: true },  // 槽2：暗轨 1↔2
];
assert.deepStrictEqual(Game.mapping(3, levels), [2, 0, 1], '空槽=恒等，暗轨参与置换');
assert.strictEqual(Game.resolve(3, levels, 0), 2, '起点0 → 2');

// trackPath：列车实际拐弯经过的岔道（事故调查回放数据源）
const crossed = Game.trackPath(levels, 0);
assert.deepStrictEqual(crossed.map(c => c.level), [1, 2], '起点0 经过槽1、槽2 两条岔道');
assert.strictEqual(crossed[0].pair, 0);
assert.strictEqual(crossed[1].hidden, true, '暗轨被经过时标记 hidden');
assert.strictEqual(Game.trackPath(levels, 1).length, 1, '起点1 只经过槽1（0↔1）');

// 直达/无岔道
assert.strictEqual(Game.trackPath([null, null], 0).length, 0, '空白级不拐弯');
assert.strictEqual(Game.trackPath([], 1).length, 0, '无线直达');
assert.strictEqual(Game.trackPath([{ pair: 1 }], 0).length, 0, '未经过该岔道不计');

// 旧格式兼容（数字 pair）
assert.strictEqual(Game.resolve(2, [0, 0], 0), 0);
assert.deepStrictEqual(Game.mapping(2, [0]), [1, 0]);
console.log('✓ Game 层级槽/置换/trackPath 单测通过');
