'use strict';
/* ============================================================
 * 端到端测试 v2
 * 覆盖：建房/加入/快照身份一致性（myId=稳定玩家id）/轮流画线/
 *      房主决定结束/置换校验/选点唯一性/超员观战/单人开局/
 *      画满自动截止/超时自动落笔/重开/重配置
 * ============================================================ */
process.env.TURN_MS = '1500';
process.env.REVEAL_MS = '1200';
process.env.REVEAL_GRACE_MS = '600';
process.env.PICK_MS = '800';
process.env.VOTE_REVEAL_MS = '600';
process.env.SWEEP_MS = '120'; // 快速扫描；TTL/宽限在场景内动态调参

const assert = require('assert');
const { io } = require('socket.io-client');
const { server, rooms } = require('../server.js');
const Game = require('../public/game.js');

const wait = ms => new Promise(r => setTimeout(r, ms));

function connect(port) {
  return new Promise((res, rej) => {
    const s = io('http://127.0.0.1:' + port, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
}

function emit(s, ev, data) {
  return new Promise(res => s.emit(ev, data, r => res(r || {})));
}

const last = arr => arr[arr.length - 1];
// 最后一个非空层级槽（服务端 levels 模型）
const lastLine = room => {
  for (let k = room.levels.length - 1; k >= 0; k--) if (room.levels[k]) return room.levels[k];
  return null;
};
// 服务端视角的完整层级（含暗轨）
const fullLevels = room => room.levels;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  console.log('◆ 测试服务器端口', port);

  /* ============ 场景一：3 人标准局 ============ */
  const [a, b, c] = await Promise.all([connect(port), connect(port), connect(port)]);
  const snaps = { a: [], b: [], c: [] };
  a.on('state', s => snaps.a.push(s));
  b.on('state', s => snaps.b.push(s));
  c.on('state', s => snaps.c.push(s));

  const results = ['洗碗', '买单', '表演节目', '唱歌', '跑腿'];
  let r = await emit(a, 'create_room', { name: '阿明', results });
  assert.strictEqual(r.error, undefined, 'create_room 应成功');
  const aId = r.playerId;
  const room = [...rooms.values()][0];
  const code = room.code;
  assert.strictEqual(room.maxLines, 20, '默认最高笔画数 20');
  console.log('✓ 建房成功:', code, 'N =', room.N, 'maxLines =', room.maxLines);

  // 房主可设置最高笔画数 20/40/80
  r = await emit(b, 'set_maxlines', { maxLines: 40 });
  assert.ok(r.error, '非房主设置笔画数被拒');
  r = await emit(a, 'set_maxlines', { maxLines: 99 });
  assert.ok(r.error, '仅支持 20/40/80');
  r = await emit(a, 'set_maxlines', { maxLines: 40 });
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(room.maxLines, 40, '最高笔画数可设为 40');
  console.log('✓ 最高笔画数 20/40/80 可配置');

  r = await emit(b, 'join_room', { code, name: '小美' });
  assert.strictEqual(r.error, undefined);
  const bId = r.playerId;
  r = await emit(c, 'join_room', { code, name: '大壮' });
  assert.strictEqual(r.error, undefined);
  const cId = r.playerId;
  await wait(80);

  // ★ 玩家座位编号 P1/P2/P3 与随机颜色
  assert.deepStrictEqual(room.players.map(p => p.seat), [1, 2, 3], '座位编号 P1/P2/P3');
  assert.strictEqual(new Set(room.players.map(p => p.color)).size, 3, '三人颜色互不相同');
  assert.ok(room.players.every(p => /^#[0-9a-f]{6}$/i.test(p.color)), '颜色为合法 hex');
  console.log('✓ 玩家座位与随机颜色');

  // ★ 快照身份一致性：myId 必须是稳定玩家 id（而非 socket id）
  assert.strictEqual(last(snaps.a).myId, aId, 'a 的 myId = 稳定 id');
  assert.strictEqual(last(snaps.b).myId, bId, 'b 的 myId = 稳定 id');
  assert.strictEqual(last(snaps.c).myId, cId, 'c 的 myId = 稳定 id');
  assert.strictEqual(last(snaps.a).hostId, aId, 'a 是房主（hostId = a 的 id）');
  assert.strictEqual(last(snaps.b).hostId, aId, 'b 视角房主也是 a');
  console.log('✓ 快照身份一致性（修复房主 UI 的关键）');

  // 房主标识：a 的 state 中能自己识别为房主（客户端 isHost 判定）
  assert.strictEqual(last(snaps.a).hostId === last(snaps.a).myId, true, 'a 应识别自己是房主');

  // --- 开始画线（无需固定笔数） ---
  r = await emit(a, 'start_drawing', {});
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(room.phase, 'drawing');
  assert.strictEqual(room.players[room.turnIdx].id, aId, '第一笔轮到房主');
  await wait(60);
  assert.strictEqual(last(snaps.a).players[last(snaps.a).turnIdx].id, last(snaps.a).myId, 'a 客户端视角：轮到我自己');
  console.log('✓ 开始画线，轮到房主（客户端 myTurn 判定正确）');

  // --- 轮流画线 7 笔（扳道岔=显手） ---
  const byId = { [aId]: a, [bId]: b, [cId]: c };
  const turnSeq = [];
  for (let l = 0; l < 7; l++) {
    const cur = room.players[room.turnIdx];
    turnSeq.push(cur.name);
    r = await emit(byId[cur.id], 'draw_line', { kind: 'open', pair: l % (room.N - 1) });
    assert.strictEqual(r.error, undefined, 'draw_line 应成功');
    assert.strictEqual(room.nextLevel, l + 1);
  }
  console.log('✓ 轮流画线 7 笔，顺序:', turnSeq.join(' → '));
  assert.strictEqual(room.phase, 'drawing', '7 笔未到上限应仍在画线阶段');
  // 层级槽与行动同步，记录施工者
  assert.strictEqual(room.nextLevel, 7, '7 槽已行动');
  const metas = room.levels.filter(Boolean);
  assert.strictEqual(metas.length, 7, '7 条实线（无 Skip）');
  metas.forEach((m, i) => {
    assert.ok(m.playerId, '每槽记录施工者');
    assert.strictEqual(m.auto, false, '手动施工');
  });
  assert.strictEqual(room.levels[0].playerId, aId, '第一槽为房主所施工');
  console.log('✓ 每槽记录施工者（玩家颜色）');

  // --- 房主决定结束 ---
  r = await emit(a, 'end_drawing', {});
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(room.phase, 'picking');
  console.log('✓ 房主决定结束画线 → 选点阶段');

  // 非房主不能结束
  r = await emit(b, 'end_drawing', {});
  assert.ok(r.error, '非房主结束画线应被拒绝');
  console.log('✓ 非房主结束被拒绝:', r.error);

  // --- 选点：重复拒绝 + 全员锁定进入揭晓 ---
  await emit(a, 'pick_start', { index: 1 });
  await emit(b, 'pick_start', { index: 3 });
  await wait(60);
  // 各自选择模式：已被选择的起点可见（玩家颜色描边数据）
  assert.strictEqual(last(snaps.a).pickedSlots[1], aId, '起点1 被 a 选择（描边数据）');
  assert.strictEqual(last(snaps.a).pickedSlots[3], bId, '起点3 被 b 选择');
  assert.strictEqual(last(snaps.a).pickedSlots[2], undefined, '未选起点不暴露');
  r = await emit(c, 'pick_start', { index: 3 });
  assert.ok(r.error, '重复起点应被拒绝');
  r = await emit(c, 'pick_start', { index: 0 });
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(room.phase, 'reveal', '全员锁定后应进入揭晓');
  console.log('✓ 选点完成 → 揭晓，picks =', JSON.stringify(room.picks));

  // --- 置换校验 ---
  const m = Game.mapping(room.N, room.levels);
  assert.strictEqual(new Set(m).size, room.N, '映射应为双射');
  const assigned = Object.values(room.assignments);
  assert.strictEqual(new Set(assigned).size, 3, '3 人结果互不相同');
  console.log('✓ 置换校验通过: mapping =', JSON.stringify(m));

  // 客户端私有字段：myPick/myResult 按稳定 id 返回
  await wait(60);
  assert.strictEqual(last(snaps.a).myPick, 1, 'a 的 myPick = 1');
  assert.strictEqual(last(snaps.a).myResult, m[1], 'a 的 myResult 与置换一致');
  assert.strictEqual(last(snaps.c).myPick, 0, 'c 选了起点 0（falsy 也能正确返回）');
  // pickedBy：锁定进度（不含起点，保持私密）
  assert.ok(Array.isArray(last(snaps.a).pickedBy), 'pickedBy 存在');
  assert.strictEqual(last(snaps.a).pickedBy.length, 3, '全员锁定');
  console.log('✓ 客户端私有字段 myPick/myResult/pickedBy 正确（含起点 0）');

  // --- 动画结束握手：部分上报不应提前 done，全员上报后立即 done ---
  a.emit('reveal_finished');
  await wait(100);
  assert.strictEqual(room.phase, 'reveal', '仅 1 人上报不应提前进入 done');
  b.emit('reveal_finished');
  c.emit('reveal_finished');
  await wait(300);
  assert.strictEqual(room.phase, 'reveal', '全员上报后先公示停留');
  await wait(700);
  assert.strictEqual(room.phase, 'done', '公示停留后进入 done');
  assert.strictEqual(last(snaps.a).finalResults[0].seat, 1, '结果表含座位编号');
  assert.strictEqual(last(snaps.a).finalResults.length, 3, '结果表 3 人');
  console.log('✓ 动画结束握手：全员上报 → 3s 公示停留 → done');

  // --- 再来一局 ---
  r = await emit(a, 'restart', {});
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(room.phase, 'drawing');
  assert.strictEqual(room.nextLevel, 0);
  console.log('✓ 再来一局 OK');

  // 非当前玩家画线拒绝
  r = await emit(b, 'draw_line', { kind: 'open', pair: 0 });
  assert.ok(r.error, '非当前玩家应被拒绝');
  console.log('✓ 越权画线被拒绝:', r.error);

  // 超时自动占槽（自动扳道岔=显手，随机位置）
  const before = room.nextLevel;
  await wait(1800);
  assert.strictEqual(room.nextLevel, before + 1, '超时后应自动占一槽');
  assert.strictEqual(lastLine(room).auto, true, '自动施工标记 auto');
  console.log('✓ 超时自动占槽 OK');

  a.close(); b.close(); c.close();
  rooms.delete(room.code);

  /* ============ 场景二：单人开局（自画自抽） ============ */
  {
    const d = await connect(port);
    const snapD = [];
    d.on('state', s => snapD.push(s));
    r = await emit(d, 'create_room', { name: '独行侠', results: ['茶', '咖啡'] });
    assert.strictEqual(r.error, undefined);
    const dId = r.playerId;
    const roomS = [...rooms.values()].find(x => x.players.some(p => p.id === dId));
    assert.ok(roomS, '单人房间存在');
    assert.strictEqual(roomS.maxLines, 20, '默认最高笔画数 20');

    // 1 人即可开局
    r = await emit(d, 'start_drawing', {});
    assert.strictEqual(r.error, undefined, '单人可开局');
    assert.strictEqual(roomS.phase, 'drawing');
    assert.strictEqual(roomS.players[roomS.turnIdx].id, dId, '单人时轮到房主自己');
    console.log('✓ 单人开局 OK');

    // 画满上限自动截止（N=2 → 20 槽，pair 恒为 0）
    for (let l = 0; l < 20; l++) {
      r = await emit(d, 'draw_line', { kind: 'open', pair: 0 });
      assert.strictEqual(r.error, undefined);
    }
    assert.strictEqual(roomS.phase, 'picking', '画满 maxLines 自动进入选点');
    console.log('✓ 画满自动截止 → 选点（房主无需操作）');

    r = await emit(d, 'pick_start', { index: 1 });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomS.phase, 'reveal', '单人锁定后立即揭晓');
    await wait(60);
    assert.strictEqual(last(snapD).myPick, 1, '单人 myPick 正确');
    assert.strictEqual(last(snapD).myResult, Game.resolve(2, roomS.levels, 1), '单人 myResult 正确');
    await wait(1600);
    assert.strictEqual(roomS.phase, 'done');
    assert.strictEqual(Object.keys(roomS.assignments).length, 1, '单人分配 1 个结果');
    console.log('✓ 单人抽签全流程（画满 → 选点 → 揭晓 → 完成）');
    d.close();
    rooms.delete(roomS.code);
  }

  /* ============ 场景三：超员观战（参与者 > 选项数） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port), connect(port), connect(port)]);
    const snapX = [];
    clients[3].on('state', s => snapX.push(s));
    r = await emit(clients[0], 'create_room', { name: 'P1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomO = [...rooms.values()][0];
    const codeO = roomO.code;
    for (let i = 1; i < 4; i++) {
      r = await emit(clients[i], 'join_room', { code: codeO, name: 'P' + (i + 1) });
      assert.strictEqual(r.error, undefined, '第 ' + (i + 1) + ' 人加入（4 人 > 3 选项）');
    }
    console.log('✓ 超员加入 OK（4 人 > 3 选项）');

    r = await emit(clients[0], 'start_drawing', {});
    assert.strictEqual(r.error, undefined, '超员也可开局');
    // 画 3 笔结束
    for (let l = 0; l < 3; l++) {
      const cur = roomO.players[roomO.turnIdx];
      const sock = clients[[clients[0], clients[1], clients[2], clients[3]].findIndex(cl => cl.id === cur.socketId)];
      r = await emit(sock, 'draw_line', { kind: 'open', pair: l % 2 });
      assert.strictEqual(r.error, undefined);
    }
    r = await emit(clients[0], 'end_drawing', {});
    assert.strictEqual(r.error, undefined);

    // 3 人锁定后（第 4 人未锁）起点即满 → 揭晓
    await emit(clients[0], 'pick_start', { index: 0 });
    await emit(clients[1], 'pick_start', { index: 1 });
    r = await emit(clients[2], 'pick_start', { index: 2 });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomO.phase, 'reveal', '起点选满即揭晓（第 4 人未锁也触发）');
    await wait(60);
    assert.strictEqual(last(snapX).myPick, null, '第 4 人（观战者）无起点');
    assert.strictEqual(last(snapX).picksCount, 3, 'picksCount = 3');
    await wait(1600);
    assert.strictEqual(roomO.phase, 'done');
    assert.strictEqual(roomO.assignments ? Object.keys(roomO.assignments).length : 0, 3, '只有 3 人获得结果');
    console.log('✓ 超员观战：起点选满自动揭晓，观战者无结果');
    clients.forEach(cl => cl.close());
    rooms.delete(roomO.code);
  }

  /* ============ 场景四：投票模式（透明化 + 房主票权重 1.5 破平票） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port), connect(port), connect(port)]);
    const snapV = [];
    clients[0].on('state', s => snapV.push(s));
    r = await emit(clients[0], 'create_room', { name: 'V1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomV = [...rooms.values()][0];
    const codeV = roomV.code;
    const v1 = r.playerId;
    const v2 = (await emit(clients[1], 'join_room', { code: codeV, name: 'V2' })).playerId;
    const v3 = (await emit(clients[2], 'join_room', { code: codeV, name: 'V3' })).playerId;
    const v4 = (await emit(clients[3], 'join_room', { code: codeV, name: 'V4' })).playerId;
    // 非房主改模式应拒绝
    r = await emit(clients[1], 'set_mode', { mode: 'vote' });
    assert.ok(r.error, '非房主设置模式应被拒绝');
    // 房主切投票模式
    r = await emit(clients[0], 'set_mode', { mode: 'vote' });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomV.mode, 'vote');
    // 开局后不可再改模式
    r = await emit(clients[0], 'start_drawing', {});
    assert.strictEqual(r.error, undefined);
    r = await emit(clients[0], 'set_mode', { mode: 'host' });
    assert.ok(r.error, '开局后不可修改模式');
    // 画 3 笔并结束
    for (let l = 0; l < 3; l++) {
      const cur = roomV.players[roomV.turnIdx];
      const sock = clients[clients.findIndex(cl => cl.id === cur.socketId)];
      await emit(sock, 'draw_line', { kind: 'open', pair: l % 2 });
    }
    await emit(clients[0], 'end_drawing', {});
    // 透明化：第一票后 voteSlots 可见（投票者色块数据），互斥占用不暴露；票数未归票前不可见
    await emit(clients[0], 'pick_start', { index: 0 });
    await wait(60);
    assert.strictEqual(last(snapV).pickedSlots, undefined, '投票模式不暴露互斥占用');
    assert.strictEqual(last(snapV).voteCounts, undefined, '归票前不公开票数（不误触发计数动画）');
    assert.ok(Array.isArray(last(snapV).voteSlots[0]) && last(snapV).voteSlots[0].indexOf(v1) >= 0, 'voteSlots 显示投票者');
    // 2:2 平票，房主票权重 1.5：host→0, V2→0, V3→1, V4→1 → {0:2.5, 1:2} → 起点0 胜出
    await emit(clients[1], 'pick_start', { index: 0 });
    await emit(clients[2], 'pick_start', { index: 1 });
    r = await emit(clients[3], 'pick_start', { index: 1 });
    assert.strictEqual(r.error, undefined);
    // 归票动画窗口：全员投完后先留在选点阶段并公开最终票数（供计数动画）
    assert.strictEqual(roomV.phase, 'picking', '归票动画期间仍为选点阶段');
    assert.strictEqual(roomV.winnerStart, 0, '房主票 1.5 打破 2:2 平票');
    assert.strictEqual(roomV.hostVoteStart, 0, '记录房主所投起点');
    assert.deepStrictEqual(roomV.voteCounts, { 0: 2.5, 1: 2 }, '票数含房主 .5 权重');
    await wait(60);
    assert.ok(last(snapV).voteCounts, '选点阶段即公开最终票数（供计数动画）');
    await wait(800); // VOTE_REVEAL_MS=600 + 缓冲
    assert.strictEqual(roomV.phase, 'reveal', '归票动画后进入揭晓');
    await wait(60);
    assert.strictEqual(last(snapV).myResult, Game.resolve(3, roomV.levels, 0), '全员共享胜出起点的结果');
    await wait(1600);
    assert.strictEqual(roomV.phase, 'done');
    assert.strictEqual(roomV.winnerResult, Game.resolve(3, roomV.levels, 0));
    console.log('✓ 投票模式：透明化 + 房主票 1.5 打破平票');
    clients.forEach(cl => cl.close());
    rooms.delete(roomV.code);
  }

  /* ============ 场景五：房主模式（N 人出一个结果） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port)]);
    r = await emit(clients[0], 'create_room', { name: 'H1', results: ['甲', '乙', '丙'], mode: 'host' });
    assert.strictEqual(r.error, undefined);
    const roomH = [...rooms.values()][0];
    const codeH = roomH.code;
    assert.strictEqual(roomH.mode, 'host', '开房时指定房主模式');
    await emit(clients[1], 'join_room', { code: codeH, name: 'H2' });
    await emit(clients[0], 'start_drawing', {});
    for (let l = 0; l < 3; l++) {
      const cur = roomH.players[roomH.turnIdx];
      const sock = clients[clients.findIndex(cl => cl.id === cur.socketId)];
      await emit(sock, 'draw_line', { kind: 'open', pair: l % 2 });
    }
    await emit(clients[0], 'end_drawing', {});
    // 非房主选点应拒绝
    r = await emit(clients[1], 'pick_start', { index: 0 });
    assert.ok(r.error, '非房主不能为全员选择');
    // 房主锁定后立即揭晓
    r = await emit(clients[0], 'pick_start', { index: 2 });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomH.phase, 'reveal', '房主锁定后立即揭晓');
    assert.strictEqual(roomH.winnerStart, 2);
    await wait(1600);
    assert.strictEqual(roomH.phase, 'done');
    assert.strictEqual(roomH.winnerResult, Game.resolve(3, roomH.levels, 2));
    console.log('✓ 房主模式：房主选点 → 全员共享一个结果');
    clients.forEach(cl => cl.close());
    rooms.delete(roomH.code);
  }

  /* ============ 场景六：选点超时自动收尾（挂机不卡局） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port)]);
    r = await emit(clients[0], 'create_room', { name: 'T1', results: ['甲', '乙'] });
    assert.strictEqual(r.error, undefined);
    const roomT = [...rooms.values()][0];
    const codeT = roomT.code;
    await emit(clients[1], 'join_room', { code: codeT, name: 'T2' });
    await emit(clients[0], 'start_drawing', {});
    for (let l = 0; l < 2; l++) {
      const cur = roomT.players[roomT.turnIdx];
      const sock = clients[clients.findIndex(cl => cl.id === cur.socketId)];
      await emit(sock, 'draw_line', { kind: 'open', pair: 0 });
    }
    await emit(clients[0], 'end_drawing', {});
    // 只有 T1 锁定，T2 挂机 → PICK_MS(800ms) 超时自动补选并揭晓
    await emit(clients[0], 'pick_start', { index: 0 });
    assert.strictEqual(roomT.phase, 'picking');
    await wait(1200);
    assert.strictEqual(roomT.phase, 'reveal', '选点超时自动补选并揭晓');
    assert.strictEqual(Object.keys(roomT.picks).length, 2, '挂机玩家被自动分配起点');
    const vals = Object.values(roomT.picks);
    assert.strictEqual(new Set(vals).size, 2, '两人起点互不相同');
    console.log('✓ 选点超时自动收尾：挂机玩家自动补选，不卡局');
    clients.forEach(cl => cl.close());
    rooms.delete(roomT.code);
  }

  /* ============ 场景七：语音中继（PCM 广播给其他玩家） ============ */
  {
    const { io: ioClient } = require('socket.io-client');
    const gameClients = await Promise.all([connect(port), connect(port)]);
    const audioClients = gameClients.map(g => ioClient('http://127.0.0.1:' + port + '/audio', { transports: ['websocket'], forceNew: true }));
    await Promise.all(audioClients.map(a => new Promise(res => a.on('connect', res))));
    const received = { a: [], b: [] };
    audioClients.forEach((a, i) => a.on('audio', (meta, chunk) => {
      received[i === 0 ? 'a' : 'b'].push({ meta, len: chunk.byteLength });
    }));
    r = await emit(gameClients[0], 'create_room', { name: 'A1', results: ['甲', '乙'] });
    assert.strictEqual(r.error, undefined);
    const roomR = [...rooms.values()][0];
    const codeR = roomR.code;
    const a1Id = r.playerId;
    const a2Id = (await emit(gameClients[1], 'join_room', { code: codeR, name: 'A2' })).playerId;
    const bindAck = (a, pid) => new Promise(res => a.emit('bind', { code: codeR, playerId: pid }, res));
    await bindAck(audioClients[0], a1Id);
    await bindAck(audioClients[1], a2Id);
    await emit(gameClients[0], 'start_drawing', {});

    // 当前玩家（P1）发声 → 其他玩家收到，自己收不到；时间戳透传
    const chunk = new Float32Array(400).buffer; // 1600 字节
    audioClients[0].emit('audio', { playerId: a1Id, sampleRate: 8000, startSample: 12345 }, chunk);
    await wait(120);
    assert.strictEqual(received.b.length, 1, 'P2 应收到 P1 的声音');
    assert.strictEqual(received.a.length, 0, 'P1 不应收到自己的声音');
    assert.strictEqual(received.b[0].meta.playerId, a1Id, '元数据含发送者');
    assert.strictEqual(received.b[0].len, 1600, 'PCM 块 1600 字节');
    assert.strictEqual(received.b[0].meta.startSample, 12345, '时间戳透传（防卡顿排程）');

    // 非当前玩家（P2）发声 → 被拒绝
    audioClients[1].emit('audio', { playerId: a2Id, sampleRate: 8000 }, chunk);
    await wait(120);
    assert.strictEqual(received.a.length, 0, '非当前玩家发声应被拒绝');

    // 结束画线后（非画线阶段）发声 → 被拒绝
    await emit(gameClients[0], 'end_drawing', {});
    audioClients[0].emit('audio', { playerId: a1Id, sampleRate: 8000 }, chunk);
    await wait(120);
    assert.strictEqual(received.b.length, 1, '非画线阶段发声应被拒绝');
    console.log('✓ 语音中继：仅当前画线玩家可发声，PCM 广播给其他玩家');

    audioClients.forEach(a => a.close());
    gameClients.forEach(g => g.close());
    rooms.delete(roomR.code);
  }

  /* ============ 场景八：退出与托管 ============ */
  {
    const { io: ioClient } = require('socket.io-client');
    const clients = await Promise.all([connect(port), connect(port), connect(port)]);
    r = await emit(clients[0], 'create_room', { name: 'L1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomL = [...rooms.values()][0];
    const codeL = roomL.code;
    const l1 = r.playerId;
    const l2 = (await emit(clients[1], 'join_room', { code: codeL, name: 'L2' })).playerId;
    const l3 = (await emit(clients[2], 'join_room', { code: codeL, name: 'L3' })).playerId;

    // P3 绑定音频后退出 → 音频绑定清理不应导致崩溃（回归测试）
    const audioL = ioClient('http://127.0.0.1:' + port + '/audio', { transports: ['websocket'], forceNew: true });
    await new Promise(res => audioL.on('connect', res));
    await new Promise(res => audioL.emit('bind', { code: codeL, playerId: l3 }, res));

    // P3（非房主）游戏中退出 → 托管
    await emit(clients[0], 'start_drawing', {});
    r = await emit(clients[2], 'leave_room', {});
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.hosted, true, '游戏内退出转为托管');
    const p3 = roomL.players.find(p => p.id === l3);
    assert.strictEqual(p3.hosted, true, 'P3 标记托管');
    assert.strictEqual(p3.online, true, '托管仍参与轮次');
    audioL.close();

    // 房主 L1 退出（当前轮到他）→ 自动占一槽（托管）→ 房主移交给 L2（真人）
    r = await emit(clients[0], 'leave_room', {});
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomL.hostId, l2, '房主移交给真人 L2');
    assert.strictEqual(roomL.nextLevel, 1, '轮到退出的房主时自动占槽');

    // L2 画 1 笔 → 轮到托管 P3 → 短暂展示后自动随机占槽
    r = await emit(clients[1], 'draw_line', { kind: 'open', pair: 0 });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomL.nextLevel, 2);
    const beforeL = roomL.nextLevel;
    await wait(1800); // HOSTED_TURN_MS=1200 + 缓冲
    assert.strictEqual(roomL.nextLevel, beforeL + 1, '托管玩家自动随机占槽');
    assert.strictEqual(lastLine(roomL).auto, true, '托管施工标记 auto');

    // 单人退出 → 销毁房间
    const solo = await connect(port);
    r = await emit(solo, 'create_room', { name: 'S1', results: ['x', 'y'] });
    assert.strictEqual(r.error, undefined);
    const codeS = [...rooms.keys()].find(k => rooms.get(k).players.some(p => p.id === r.playerId));
    r = await emit(solo, 'leave_room', {});
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.destroyed, true, '单人退出销毁房间');
    assert.strictEqual(rooms.has(codeS), false, '房间已从服务器删除');

    console.log('✓ 退出与托管：托管随机落笔、房主移交、单人退出销毁房间');
    clients.forEach(c => c.close());
    solo.close();
    rooms.delete(roomL.code);
  }

  /* ============ 场景九：单轮模式（交错槽归属 + 一次交接填完 + 暗轨/待命配额 + 超时自动占槽） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port), connect(port)]);
    r = await emit(clients[0], 'create_room', { name: 'R1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomR = [...rooms.values()][0];
    const codeR = roomR.code;
    const r1 = r.playerId;
    const r2 = (await emit(clients[1], 'join_room', { code: codeR, name: 'R2' })).playerId;
    const r3 = (await emit(clients[2], 'join_room', { code: codeR, name: 'R3' })).playerId;
    // 非房主设置轮次被拒
    r = await emit(clients[1], 'set_round', { roundMode: 'single' });
    assert.ok(r.error, '非房主设置轮次应被拒绝');
    r = await emit(clients[0], 'set_round', { roundMode: 'single' });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomR.roundMode, 'single');
    r = await emit(clients[0], 'start_drawing', {});
    assert.strictEqual(r.error, undefined);
    // 槽归属 round-robin 预分配（数学顺序保持交错）
    assert.strictEqual(roomR.slotOwner[0], r1, '槽0 属 R1');
    assert.strictEqual(roomR.slotOwner[1], r2, '槽1 属 R2');
    assert.strictEqual(roomR.slotOwner[2], r3, '槽2 属 R3');
    assert.strictEqual(roomR.slotOwner[3], r1, '槽3 回到 R1（交错）');
    assert.strictEqual(roomR.players[roomR.turnIdx].id, r1, '先轮到 R1');
    // R1 的槽：0,3,6,9,12,15,18（7 槽）
    r = await emit(clients[0], 'draw_line', { kind: 'dark', pair: 0 }); // 暗轨：槽0
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomR.levels[0].hidden, true, '暗轨线隐藏标记');
    assert.strictEqual(roomR.players.find(p => p.id === r1).darkLeft, 0, '暗轨配额用完');
    r = await emit(clients[0], 'draw_line', { kind: 'dark', pair: 1 }); // 第二次暗轨被拒
    assert.ok(r.error, '暗轨配额已尽应被拒绝');
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 1 }); // 槽3
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomR.players[roomR.turnIdx].id, r1, 'R1 未填完仍是他回合');
    assert.strictEqual(roomR.levels[3].pair, 1, '槽3 落线（跳过空槽 1,2）');
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 }); // 槽6
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 1 }); // 槽9
    r = await emit(clients[0], 'draw_line', { kind: 'skip' });         // 槽12 待命
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomR.levels[12], null, '待命槽无线');
    assert.strictEqual(roomR.nextLevel, 5, '5 槽已行动（含待命）');
    assert.strictEqual(roomR.players.find(p => p.id === r1).skipLeft, 0, '待命配额用完');
    r = await emit(clients[0], 'draw_line', { kind: 'skip' }); // 第二次待命被拒
    assert.ok(r.error, '待命配额已尽应被拒绝');
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 }); // 槽15
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 1 }); // 槽18
    assert.strictEqual(roomR.players[roomR.turnIdx].id, r2, 'R1 填完 7 槽后轮到 R2');
    assert.strictEqual(roomR.nextLevel, 7);
    // 非当前玩家越权（轮到 R2，R1 不能动）
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 });
    assert.ok(r.error, '非当前玩家越权被拒');
    // R2 填 6 槽（1,4,7,10,13,16），最后一槽（19）等待超时自动占槽
    for (let l = 0; l < 6; l++) {
      assert.strictEqual(roomR.players[roomR.turnIdx].id, r2, '第 ' + l + ' 槽仍是 R2 回合');
      r = await emit(clients[1], 'draw_line', { kind: 'open', pair: l % 2 });
      assert.strictEqual(r.error, undefined);
    }
    const beforeR = roomR.nextLevel; // = 14
    await wait(1800); // TURN_MS=1500 + 缓冲 → 槽19 自动占槽
    assert.strictEqual(roomR.nextLevel, beforeR + 1, '单轮超时自动占槽');
    assert.strictEqual(lastLine(roomR).auto, true, '超时施工标记 auto');
    assert.strictEqual(roomR.players[roomR.turnIdx].id, r3, 'R2 填完后轮到 R3');
    // R3 填完 6 槽（2,5,8,11,14,17）→ 全部 20 槽行动 → 选点
    for (let l = 0; l < 6; l++) {
      r = await emit(clients[2], 'draw_line', { kind: 'open', pair: l % 2 });
      assert.strictEqual(r.error, undefined);
    }
    assert.strictEqual(roomR.nextLevel, 20, '20 槽全部行动');
    assert.strictEqual(roomR.phase, 'picking', '全部填完自动进入选点');
    console.log('✓ 单轮模式：交错槽归属、一次交接填完、暗轨/待命配额、超时自动占槽');
    clients.forEach(c => c.close());
    rooms.delete(roomR.code);
  }

  /* ============ 场景十：自定义像素化背景（set_bg / bg 广播 / 加入补发 / 校验） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port)]);
    const bgRecv = [];
    clients[1].on('bg', url => bgRecv.push(url));
    r = await emit(clients[0], 'create_room', { name: 'B1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomB = [...rooms.values()][0];
    const codeB = roomB.code;
    await emit(clients[1], 'join_room', { code: codeB, name: 'B2' });
    await wait(80);
    assert.strictEqual(bgRecv.length, 0, '无背景时加入不发送 bg 事件');
    // 非房主设置被拒
    r = await emit(clients[1], 'set_bg', { dataUrl: 'data:image/png;base64,AAAA' });
    assert.ok(r.error, '非房主设置背景被拒');
    // 非法数据被拒（非 data:image 前缀）
    r = await emit(clients[0], 'set_bg', { dataUrl: 'http://evil.com/x.png' });
    assert.ok(r.error, '非法图片数据被拒');
    // 超限被拒（>500000 字符）
    r = await emit(clients[0], 'set_bg', { dataUrl: 'data:image/png;base64,' + 'A'.repeat(600000) });
    assert.ok(r.error, '过大图片被拒');
    assert.strictEqual(roomB.bg, null, '失败请求不落库');
    // 房主设置成功 → 全房广播
    r = await emit(clients[0], 'set_bg', { dataUrl: 'data:image/png;base64,BBBB' });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomB.bg, 'data:image/png;base64,BBBB', '服务端存 bg');
    await wait(80);
    assert.strictEqual(last(bgRecv), 'data:image/png;base64,BBBB', '全员收到背景广播');
    // 后来者加入 → 补发当前背景
    const late = await connect(port);
    const lateRecv = [];
    late.on('bg', url => lateRecv.push(url));
    await emit(late, 'join_room', { code: codeB, name: 'B3' });
    await wait(80);
    assert.strictEqual(last(lateRecv), 'data:image/png;base64,BBBB', '新加入者补发背景');
    // 重开房间（reconfigure 回大厅）后背景保留
    r = await emit(clients[0], 'reconfigure', {});
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomB.bg, 'data:image/png;base64,BBBB', '重开后背景保留');
    // 清除背景
    r = await emit(clients[0], 'set_bg', { dataUrl: null });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomB.bg, null, '清除后置空');
    await wait(80);
    assert.strictEqual(last(bgRecv), null, '全员收到清除广播');
    console.log('✓ 自定义背景：仅房主、校验、广播、加入补发、重开保留、清除');
    clients.forEach(c => c.close());
    late.close();
    rooms.delete(roomB.code);
  }

  /* ============ 场景十一：房间闲置 TTL 回收 ============ */
  {
    process.env.ROOM_TTL_MS = '500'; // 动态调参：500ms 无活动即回收
    const clients = await Promise.all([connect(port), connect(port)]);
    const closedRecv = [];
    clients[0].on('room_closed', d => closedRecv.push(d));
    clients[1].on('room_closed', d => closedRecv.push(d));
    r = await emit(clients[0], 'create_room', { name: 'T1', results: ['甲', '乙'] });
    assert.strictEqual(r.error, undefined);
    const roomT = [...rooms.values()][0];
    const codeT = roomT.code;
    await emit(clients[1], 'join_room', { code: codeT, name: 'T2' });
    await wait(1000); // > 500ms 无活动 → 回收
    assert.strictEqual(rooms.has(codeT), false, '闲置超 TTL 房间被回收');
    assert.strictEqual(closedRecv.length, 2, '房内全员收到 room_closed');
    assert.ok(/无活动/.test(closedRecv[0].reason), '回收原因提示无活动');
    console.log('✓ 房间 TTL：闲置超时回收 + room_closed 通知全员');
    clients.forEach(c => c.close());
    delete process.env.ROOM_TTL_MS; // 恢复默认，避免影响后续场景
  }

  /* ============ 场景十二：僵尸房回收（全员掉线/托管） ============ */
  {
    process.env.ZOMBIE_GRACE_MS = '400'; // 动态调参：全员非人 400ms 即回收
    const clients = await Promise.all([connect(port), connect(port)]);
    const closedRecv = [];
    clients[0].on('room_closed', d => closedRecv.push(d));
    clients[1].on('room_closed', d => closedRecv.push(d));
    r = await emit(clients[0], 'create_room', { name: 'Z1', results: ['甲', '乙'] });
    assert.strictEqual(r.error, undefined);
    const roomZ = [...rooms.values()][0];
    const codeZ = roomZ.code;
    await emit(clients[1], 'join_room', { code: codeZ, name: 'Z2' });
    r = await emit(clients[0], 'start_drawing', {});
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomZ.phase, 'drawing');
    // 两人都在游戏中退出 → 全员托管，自动推进会持续广播，但墙钟计时不受影响
    r = await emit(clients[0], 'leave_room', {});
    assert.strictEqual(r.error, undefined);
    r = await emit(clients[1], 'leave_room', {});
    assert.strictEqual(r.error, undefined);
    await wait(1000); // > 400ms 宽限 → 回收
    assert.strictEqual(rooms.has(codeZ), false, '全员托管僵尸房被回收');
    // room_closed 只发给仍在房间内的 socket；两位均已主动退出（退出时已清理会话），故收不到是正确语义
    assert.strictEqual(closedRecv.length, 0, '已退出者不在房间内，无需通知');
    console.log('✓ 僵尸房回收：全员掉线/托管（自动推进不干扰墙钟计时；已退出者不通知）');
    clients.forEach(c => c.close());
    delete process.env.ZOMBIE_GRACE_MS;
  }

  /* ============ 场景十三：暗轨（暗手）隐私与揭晓全显 ============ */
  {
    const clients = await Promise.all([connect(port), connect(port)]);
    const snapP1 = [];
    const snapP2 = [];
    clients[0].on('state', s => snapP1.push(s));
    clients[1].on('state', s => snapP2.push(s));
    r = await emit(clients[0], 'create_room', { name: 'K1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomK = [...rooms.values()][0];
    const codeK = roomK.code;
    const k1 = r.playerId;
    const k2 = (await emit(clients[1], 'join_room', { code: codeK, name: 'K2' })).playerId;
    await emit(clients[0], 'start_drawing', {});
    // 标准模式一人一笔轮流：K1 槽0 扳道岔(pair0) → K2 槽1 暗轨(pair1) → K1 槽2 扳道岔(pair0)
    // 纠缠度：1 + 1.5 + 1 = 3.5 < 4 → 不触发雾幕（保持场景只测暗轨）
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 });
    assert.strictEqual(r.error, undefined);
    r = await emit(clients[1], 'draw_line', { kind: 'dark', pair: 1 });
    assert.strictEqual(r.error, undefined);
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 });
    assert.strictEqual(r.error, undefined);
    await wait(60);
    assert.strictEqual(roomK.fogLevels.size, 0, '该线序不触发雾幕');
    // 本人（K2）视角：看到自己的暗轨线 + 配额扣减
    assert.strictEqual(last(snapP2).levels[1].hidden, true, '本人视角可见暗轨线');
    assert.strictEqual(last(snapP2).darkLeft, 0, '本人暗轨配额扣减');
    // 他人视角：暗轨呈现为空槽（与待命一致）
    assert.strictEqual(last(snapP1).levels[0].pair, 0, '他人可见显手线');
    assert.strictEqual(last(snapP1).levels[1], null, '他人视角暗轨为空槽');
    assert.strictEqual(last(snapP1).darkLeft, 1, '他人配额不受影响');
    // 暗轨真实参与置换：完整 levels 的映射 ≠ 他人视角（缺暗轨）的映射
    // 完整 [{0},{1},{0}] → [2,1,0]；K1 视角 [{0},null,{0}] → 起点0 → 0
    const mFull = Game.mapping(3, roomK.levels);
    const mP1 = Game.mapping(3, last(snapP1).levels);
    assert.strictEqual(mFull[0], 2, '完整映射：起点0 → 槽0(0↔1) 槽1(1↔2) 槽2(0↔1) → 2');
    assert.strictEqual(mP1[0], 0, '他人视角（缺暗轨）：起点0 → 0（推演错误即信息缺口）');
    // 结束 → 选点 → 揭晓：暗轨在揭晓阶段全显（含他人视角）
    await emit(clients[0], 'end_drawing', {});
    await emit(clients[0], 'pick_start', { index: 0 });
    await emit(clients[1], 'pick_start', { index: 2 });
    await wait(60);
    assert.strictEqual(roomK.phase, 'reveal');
    assert.strictEqual(last(snapP1).levels[1].hidden, true, '揭晓阶段暗轨对他人全显');
    assert.strictEqual(last(snapP1).levels[1].playerId, k2, '揭晓阶段可见暗轨归属');
    // 最终结果按完整置换计算（含暗轨）
    await wait(60);
    assert.strictEqual(last(snapP2).myResult, mFull[2], '结果按含暗轨的完整置换计算');
    await wait(1600);
    assert.strictEqual(roomK.phase, 'done');
    console.log('✓ 暗轨：本人可见/他人空槽、揭晓全显点名、真实参与置换');
    clients.forEach(c => c.close());
    rooms.delete(roomK.code);
  }

  /* ============ 场景十四：夜色雾开关（仅房主、仅开局前） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port)]);
    r = await emit(clients[0], 'create_room', { name: 'F1', results: ['甲', '乙'] });
    assert.strictEqual(r.error, undefined);
    const roomF = [...rooms.values()][0];
    const codeF = roomF.code;
    await emit(clients[1], 'join_room', { code: codeF, name: 'F2' });
    assert.strictEqual(roomF.fog, true, '默认迷雾开启');
    r = await emit(clients[1], 'set_fog', { fog: false });
    assert.ok(r.error, '非房主设置迷雾被拒');
    r = await emit(clients[0], 'set_fog', { fog: 'yes' });
    assert.ok(r.error, '非法值被拒');
    r = await emit(clients[0], 'set_fog', { fog: false });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomF.fog, false, '房主可关闭迷雾');
    // 开局后不可修改
    await emit(clients[0], 'start_drawing', {});
    r = await emit(clients[0], 'set_fog', { fog: true });
    assert.ok(r.error, '开局后不可修改迷雾');
    // 迷雾设置随快照下发
    await wait(60);
    console.log('✓ 夜色雾开关：默认开启、仅房主、仅开局前');
    clients.forEach(c => c.close());
    rooms.delete(roomF.code);
  }

  /* ============ 场景十五：雾幕纠缠度（触发/不触发/重复加成/多雾区/隐私/揭晓全显） ============ */
  {
    const clients = await Promise.all([connect(port), connect(port)]);
    const snapP1 = [];
    const snapP2 = [];
    clients[0].on('state', s => snapP1.push(s));
    clients[1].on('state', s => snapP2.push(s));
    r = await emit(clients[0], 'create_room', { name: 'M1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomM = [...rooms.values()][0];
    const codeM = roomM.code;
    const m2 = (await emit(clients[1], 'join_room', { code: codeM, name: 'M2' })).playerId;
    await emit(clients[0], 'start_drawing', {});
    // 部分A：重复显手触发（显1 + 重复显1.5 + 重复显1.5 = 4）
    await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 }); // s0: 1
    await emit(clients[1], 'draw_line', { kind: 'open', pair: 0 }); // s1: 1+0.5=1.5（与 s0 同轨）
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 }); // s2: 1.5
    assert.strictEqual(r.error, undefined);
    assert.ok(roomM.fogLevels.has(0) && roomM.fogLevels.has(1) && roomM.fogLevels.has(2), '三条同轨显手触发雾区 {0,1,2}');
    // 部分B：新三线（s1,s2,s3）再次触发 → 多雾区并存
    await emit(clients[1], 'draw_line', { kind: 'open', pair: 1 }); // s3: 1（换轨）
    assert.strictEqual(roomM.fogLevels.has(3), true, '第二组三线触发，雾区扩展 {0,1,2,3}');
    // 部分C：skip 不触发（s2 1.5 + s3 1 + s4 0 = 2.5）
    await emit(clients[0], 'draw_line', { kind: 'skip' });          // s4: 0
    assert.strictEqual(roomM.fogLevels.size, 4, 'skip 后不触发新雾区');
    await wait(60);
    // 隐私：雾区层级对他人不可读（呈空槽），本人自己的线可见（双向视角）
    assert.strictEqual(last(snapP2).levels[0], null, 'P2 视角：雾区层 s0（K1 的线）为空槽');
    assert.strictEqual(last(snapP1).levels[1], null, 'P1 视角：雾区层 s1（K2 的线）为空槽');
    assert.strictEqual(last(snapP2).levels[2], null, 'P2 视角：雾区层 s2（K1 的线）为空槽');
    assert.strictEqual(last(snapP1).levels[3], null, 'P1 视角：雾区层 s3（K2 的线）为空槽');
    assert.strictEqual(last(snapP2).levels[1].pair, 0, 'P2 视角：自己画在雾区的线仍可见');
    assert.strictEqual(last(snapP1).levels[0].pair, 0, 'P1 视角：自己画在雾区的线仍可见');
    assert.strictEqual(last(snapP2).levels[3].pair, 1, 'P2 视角：雾区层 s3 自己的线可见');
    assert.strictEqual(last(snapP2).levels[4], null, 'skip 层无线');
    assert.ok(Array.isArray(last(snapP1).fogLevels) && last(snapP1).fogLevels.length === 4, 'fogLevels 公开下发');
    // 揭晓：雾区全显
    await emit(clients[0], 'end_drawing', {});
    await emit(clients[0], 'pick_start', { index: 0 });
    await emit(clients[1], 'pick_start', { index: 2 });
    await wait(60);
    assert.strictEqual(roomM.phase, 'reveal');
    assert.strictEqual(last(snapP2).levels[0].pair, 0, '揭晓阶段雾区线对他人全显');
    assert.strictEqual(last(snapP2).levels[1].playerId, m2, '揭晓阶段可见雾区线归属（K2 的线）');
    await wait(1600);
    assert.strictEqual(roomM.phase, 'done');
    clients.forEach(c => c.close());
    rooms.delete(roomM.code);

    // 部分D：暗手贡献 + 重复暗手（暗1.5 + 重复暗2 + 显1 = 4.5）触发
    const clients2 = await Promise.all([connect(port), connect(port)]);
    r = await emit(clients2[0], 'create_room', { name: 'M2', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomD = [...rooms.values()][0];
    const codeD = roomD.code;
    await emit(clients2[1], 'join_room', { code: codeD, name: 'M2B' });
    await emit(clients2[0], 'start_drawing', {});
    await emit(clients2[0], 'draw_line', { kind: 'dark', pair: 0 });  // s0: 暗 1.5
    await emit(clients2[1], 'draw_line', { kind: 'dark', pair: 0 });  // s1: 暗 1.5+0.5=2（重复暗手）
    r = await emit(clients2[0], 'draw_line', { kind: 'open', pair: 1 }); // s2: 显 1（换轨）
    assert.strictEqual(r.error, undefined);
    assert.ok(roomD.fogLevels.has(0) && roomD.fogLevels.has(1) && roomD.fogLevels.has(2), '暗手+重复暗手触发雾区');
    console.log('✓ 雾幕：纠缠度触发（重复显/暗手+重复）、多雾区并存、快照隐私、揭晓全显');
    clients2.forEach(c => c.close());
    rooms.delete(roomD.code);
  }

  /* ============ 场景十六：纠缠度按 canvas 相邻三行区域判定 ============ */
  {
    // 部分 A：多轮——连续三行同轨道 → 区域整体覆盖并随新线扩展
    const clients = await Promise.all([connect(port), connect(port)]);
    r = await emit(clients[0], 'create_room', { name: 'E1', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomE = [...rooms.values()][0];
    const codeE = roomE.code;
    await emit(clients[1], 'join_room', { code: codeE, name: 'E2' });
    await emit(clients[0], 'start_drawing', {});
    await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 }); // 槽0
    await emit(clients[1], 'draw_line', { kind: 'open', pair: 0 }); // 槽1
    r = await emit(clients[0], 'draw_line', { kind: 'open', pair: 0 }); // 槽2 → 区域[0,1,2]=1+1.5+1.5=4
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomE.fogLevels.size, 3, '区域 [0,1,2] 三行全部覆盖');
    assert.ok(roomE.fogLevels.has(0) && roomE.fogLevels.has(1) && roomE.fogLevels.has(2), '雾幕为连续区域，非离散单行');
    r = await emit(clients[1], 'draw_line', { kind: 'open', pair: 1 }); // 槽3 → 区域[1,2,3]=1.5+1.5+1=4
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomE.fogLevels.size, 4, '新线触发区域 [1,2,3]，雾幕扩展为 {0,1,2,3}');
    assert.ok(roomE.fogLevels.has(3), '槽3 加入雾幕');
    clients.forEach(c => c.close());
    rooms.delete(roomE.code);

    // 部分 B：单轮——第一位玩家离散铺轨永不触发；B 顶部绘制不影响 A 底部（无跨界雾幕）
    const clients2 = await Promise.all([connect(port), connect(port), connect(port)]);
    r = await emit(clients2[0], 'create_room', { name: 'E2', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomS = [...rooms.values()][0];
    const codeS = roomS.code;
    await emit(clients2[1], 'join_room', { code: codeS, name: 'E2B' });
    await emit(clients2[2], 'join_room', { code: codeS, name: 'E2C' });
    await emit(clients2[0], 'set_round', { roundMode: 'single' });
    await emit(clients2[0], 'start_drawing', {});
    // A（槽 0,3,6,9,12,15,18）离散铺轨：每个区域皆空 → 永不触发
    for (let i = 0; i < 7; i++) {
      r = await emit(clients2[0], 'draw_line', { kind: 'open', pair: 0 });
      assert.strictEqual(r.error, undefined);
    }
    assert.strictEqual(roomS.fogLevels.size, 0, '第一位玩家离散铺轨永不触发');
    // B 画槽1（与 A 槽0 相邻同 pair）：区域[0,1]=1+1.5=2.5 → 不触发，且绝不波及 A 的底部槽
    r = await emit(clients2[1], 'draw_line', { kind: 'open', pair: 0 });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomS.fogLevels.size, 0, 'B 一条重复尚不足触发');
    assert.ok(!roomS.fogLevels.has(15) && !roomS.fogLevels.has(18), 'B 顶部绘制不会给 A 底部槽加雾幕（无跨界）');
    // B 画槽4（区域[2,3,4]：空+A显+B重复=2.5）→ 仍不触发（区域判定，非时间序窗口）
    r = await emit(clients2[1], 'draw_line', { kind: 'open', pair: 0 });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(roomS.fogLevels.size, 0, 'B 离散重复不触发（区域只有两条线）');
    console.log('✓ 纠缠度区域判定：多轮连续触发+扩展、单轮离散不触发、无跨界雾幕');
    clients2.forEach(c => c.close());
    rooms.delete(roomS.code);

    // 部分 C：2 人单轮——区域中间行最后落定也应触发（先后顺序不影响雾幕生成）
    const clients3 = await Promise.all([connect(port), connect(port)]);
    r = await emit(clients3[0], 'create_room', { name: 'E3', results: ['甲', '乙', '丙'] });
    assert.strictEqual(r.error, undefined);
    const roomT = [...rooms.values()][0];
    const codeT = roomT.code;
    await emit(clients3[1], 'join_room', { code: codeT, name: 'E3B' });
    await emit(clients3[0], 'set_round', { roundMode: 'single' });
    await emit(clients3[0], 'start_drawing', {});
    // A 槽 0,2,4,...,18（偶数）先填满：0/2/8/10/16/18 用 p0，其余 p1 —— 区域均不达标
    const aPairs2 = [0, 0, 1, 1, 0, 0, 1, 1, 0, 0];
    for (let i = 0; i < aPairs2.length; i++) {
      r = await emit(clients3[0], 'draw_line', { kind: 'open', pair: aPairs2[i] });
      assert.strictEqual(r.error, undefined);
    }
    assert.strictEqual(roomT.fogLevels.size, 0, 'A 填满后无任何区域达标');
    // B 画槽1(p0)：区域 [0,1,2] 三行已定型（A0、B1、A2）→ 1+1.5+1.5=4 → 触发（中间行最后落定也不遗漏）
    r = await emit(clients3[1], 'draw_line', { kind: 'open', pair: 0 });
    assert.strictEqual(r.error, undefined);
    assert.ok(roomT.fogLevels.has(0) && roomT.fogLevels.has(1) && roomT.fogLevels.has(2), '区域 [0,1,2] 触发——先后顺序不影响判定');
    console.log('✓ 纠缠度顺序无关：区域中间行最后落定同样触发');
    clients3.forEach(c => c.close());
    rooms.delete(roomT.code);
  }

  await new Promise(r2 => server.close(r2));
  console.log('========== 全部测试通过 ✓ ==========');
  process.exit(0);
})().catch(e => {
  console.error('========== 测试失败 ==========');
  console.error(e);
  process.exit(1);
});