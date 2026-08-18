/* ============================================================
 * 服务端类型定义（types.d.ts）——仅类型，不参与运行时
 * 新增 @ts-check 的服务端文件引用这些全局接口
 * 用法示例（rooms.js）：
 *   /** @param {Room} room * /
 * 详见 docs/CONTRIBUTING.md §7
 * ============================================================ */

interface Player {
  id: string;
  socketId: string | null;
  name: string;
  online: boolean;
  seat: number;
  color: string;
  hosted?: boolean;
  darkLeft: number; // 每局暗轨（暗手）配额
  skipLeft: number; // 每局工务组待命（Skip）配额
}

interface LevelSlot {
  pair: number;
  hidden: boolean;
  playerId: string | null;
  auto: boolean;
}

interface Room {
  code: string;
  phase: 'lobby' | 'drawing' | 'picking' | 'reveal' | 'done';
  mode: 'individual' | 'host' | 'vote';
  roundMode: 'multi' | 'single';
  N: number;
  results: string[];
  maxLines: number;
  fog: boolean; // 夜色雾开关（房主大厅可切换）
  levels: (LevelSlot | null)[]; // 固定层级槽（null = 空白级/未施工）
  acted: Set<number>;           // 已行动（占槽）的层级索引
  nextLevel: number;            // 已行动槽数
  slotOwner: (string | null)[]; // 单轮模式槽归属（round-robin）；标准模式全 null
  fogLevels: Set<number>;       // 雾幕区层级（纠缠度超标生成，按 canvas 相邻三行区域覆盖）
  players: Player[];
  turnIdx: number;
  turnDeadline: number | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  pickTimer: ReturnType<typeof setTimeout> | null;
  picks: Record<string, number>;
  pickedStarts: Set<number>;
  startedAt: number | null;
  hostId: string | null;
  revealTimer: ReturnType<typeof setTimeout> | null;
  voteRevealTimer: ReturnType<typeof setTimeout> | null;
  winnerStart: number | null;
  winnerResult: number | null;
  voteCounts: Record<number, number> | null;
  bg: string | null;
  lastActivity: number;
  allOfflineSince: number | null;
  hostVoteStart?: number | null;
  assignments?: Record<string, number>;
  revealDone?: { reported: Set<string>; startedAt: number };
}

/** 房间状态快照（snapshot() 返回，客户端 S 的对应物） */
interface RoomSnapshot {
  myId: string;
  code: string;
  phase: Room['phase'];
  N: number;
  results: string[];
  levels: (LevelSlot | null)[];
  nextLevel: number;
  players: Array<{
    id: string;
    name: string;
    online: boolean;
    color: string;
    seat: number;
    hosted?: boolean;
  }>;
  turnIdx: number;
  turnDeadline: number | null;
  turnName: string | null;
  picksCount: number;
  hostId: string | null;
  maxLines: number;
  mode: Room['mode'];
  roundMode: Room['roundMode'];
  fog: boolean;
  [key: string]: unknown;
}
