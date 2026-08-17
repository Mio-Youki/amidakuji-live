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
}

interface Room {
  code: string;
  phase: 'lobby' | 'drawing' | 'picking' | 'reveal' | 'done';
  mode: 'individual' | 'host' | 'vote';
  roundMode: 'multi' | 'single';
  N: number;
  results: string[];
  maxLines: number;
  quota: number;
  turnLines: number;
  playerLines: Record<string, number>;
  lines: number[];
  lineMeta: Array<{ playerId: string | null; auto: boolean }>;
  nextLevel: number;
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
  lines: number[];
  lineMeta: Room['lineMeta'];
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
  quota: number;
  turnLines: number;
  [key: string]: unknown;
}
