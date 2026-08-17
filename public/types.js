/* ============================================================
 * 客户端类型定义（types.js）——仅 JSDoc typedef，无运行时逻辑
 * 约定：文件顶部加 `// @ts-check` 启用检查；新增代码引用这里的类型
 * 用法示例：
 *   /** @type {import('./types.js').RoomState | null} * / let S = null;
 * 详见 docs/CONTRIBUTING.md §7
 * ============================================================ */

/**
 * 玩家快照
 * @typedef {Object} PlayerState
 * @property {string} id      稳定玩家 id（跨重连不变）
 * @property {string} name    昵称
 * @property {boolean} online 是否在线
 * @property {string} color   玩家颜色（hex）
 * @property {number} seat    座位编号（P1/P2…）
 * @property {boolean} [hosted] 是否托管
 */

/**
 * 房间状态快照（服务端 snapshot() 下发，state.js 存 S）
 * @typedef {Object} RoomState
 * @property {string} myId
 * @property {string} code
 * @property {'lobby'|'drawing'|'picking'|'reveal'|'done'} phase
 * @property {number} N
 * @property {string[]} results
 * @property {number[]} lines
 * @property {Array<{playerId: string|null, auto: boolean}>} lineMeta
 * @property {number} nextLevel
 * @property {PlayerState[]} players
 * @property {number} turnIdx
 * @property {number} turnDeadline
 * @property {string} turnName
 * @property {number} picksCount
 * @property {string} hostId
 * @property {number} maxLines
 * @property {'individual'|'host'|'vote'} mode
 * @property {'multi'|'single'} roundMode
 * @property {number} quota
 * @property {number} turnLines
 * @property {number} [myPick]
 * @property {string[]} [pickedBy]
 * @property {Record<number, string>} [pickedSlots]
 * @property {Record<number, string[]>} [voteSlots]
 * @property {Record<number, number>} [voteCounts]
 * @property {number} [hostVoteStart]
 * @property {number} [winnerStart]
 * @property {number} [myResult]
 * @property {Record<string, number>} [starts]
 * @property {Array<{playerId: string, seat: number, name: string, color: string, hosted?: boolean, start: number, result: number, resultText: string}>} [finalResults]
 * @property {string} [resultText]
 */

/**
 * 画板绘制配置（board.js draw(cfg) 入参）
 * @typedef {Object} BoardCfg
 * @property {RoomState['phase']} phase
 * @property {number} N
 * @property {number} M
 * @property {number[]} lines
 * @property {string[]} [lineColors]
 * @property {boolean[]} [lineAuto]
 * @property {number} nextLevel
 * @property {string[]} results
 * @property {boolean} myTurn
 * @property {number|null} [previewPair]
 * @property {string} [guideColor]
 * @property {number|null} [slotSel]
 * @property {number|null} [myPick]
 * @property {Record<number, string>} [pickedSlots]
 * @property {Record<number, string[]>} [voteSlots]
 * @property {Record<number, number>} [voteCounts]
 * @property {number} [hostVoteStart]
 * @property {string} [hostColor]
 * @property {Record<number, {int: number, half: boolean, scale: number, ty: number, alpha: number}>} [voteCountAnim]
 * @property {Record<number, boolean>} [revealed]
 * @property {Array<{playerId: string|null, start: number, color: string, isMe: boolean, x?: number, y?: number}>} [markers]
 */

/**
 * 语音采样帧（voice.js sample() 返回）
 * @typedef {Object} VoiceSample
 * @property {number} rms
 * @property {number} freq
 * @property {number} confidence
 */

/**
 * socket 客户端事件载荷（client→server）
 * @typedef {Object} SocketEvents
 * @property {{name: string, results: string[], mode?: string}} create_room
 * @property {{code: string, name: string}} join_room
 * @property {{code: string, playerId: string, name?: string}} rejoin
 * @property {{results: string[]}} update_results
 * @property {{mode: 'individual'|'host'|'vote'}} set_mode
 * @property {{roundMode: 'multi'|'single'}} set_round
 * @property {{maxLines: number}} set_maxlines
 * @property {{dataUrl: string | null}} set_bg
 * @property {{}} start_drawing
 * @property {{pair: number}} draw_line
 * @property {{}} end_drawing
 * @property {{}} end_turn
 * @property {{index: number}} pick_start
 * @property {{}} leave_room
 * @property {{}} restart
 * @property {{}} reconfigure
 * @property {{}} reveal_finished
 * @property {{code: string, playerId: string}} bind
 * @property {{playerId: string, sampleRate: number, startSample: number}} audio
 */

// 标记为模块，使 JSDoc 的 import('./types.js').X 类型引用可解析
export {};
