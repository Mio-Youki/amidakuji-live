/* ============================================================
 * 客户端全局声明（globals.d.ts）——仅类型，不参与运行时
 * 声明来自外部脚本（socket.io.js）或未加 @ts-check 的既有模块的全局
 * 新增 @ts-check 文件时，如需新全局请在此登记
 * ============================================================ */

/** 外部脚本 socket.io.js 注入的全局函数 */
declare function io(namespace?: string): SocketClient;

/** socket.io 客户端最小接口（按需扩展） */
interface SocketClient {
  id: string;
  connected: boolean;
  on(event: string, fn: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): this;
  disconnect(): void;
  connect(): void;
}

/** audio.js 暴露的音效 API */
interface AudioSysApi {
  unlock(): void;
  getContext(): AudioContext | null;
  isMuted(): boolean;
  setMuted(m: boolean): void;
  click(): void;
  pen(): void;
  autoPen(): void;
  tick(): void;
  turn(): void;
  riser(): void;
  fanfare(): void;
  cheer(): void;
  error(): void;
  startGame(): void;
  revealDark(): void;
}

/** board.js 暴露的画板 API */
interface BoardApi {
  setup(canvas: HTMLCanvasElement): void;
  resize(w: number, h: number): void;
  computeGeometry(N: number, M: number): any;
  draw(cfg: any): void;
  hitTest(x: number, y: number): { pair: number | null; slot: number | null };
  runReveal(cfg: any, onFlip?: (pid: string | null, resIdx: number, isMe: boolean) => void): Promise<any>;
  cancelReveal(): void;
  setBg(img: HTMLImageElement | null): void;
  drawTo(canvas: HTMLCanvasElement, cfg: any): void;
}

/** pixelate.js 暴露的像素化背景 API */
interface PixelBGApi {
  img: HTMLImageElement | null;
  set(img: HTMLImageElement | null): void;
  clear(): void;
  pixelateFile(file: File, cb: (url: string | null) => void): void;
}

/** home-scene.js 暴露的首页低帧率氛围动画 API */
interface HomeSceneApi {
  init(): void;
  start(): void;
  stop(): void;
}

/** voice.js 暴露的麦克风/DSP API（状态属性由代理同步到内层） */
interface VoiceApi {
  detectPitch(buffer: Float32Array, sampleRate: number): import('./types.js').VoiceSample;
  downsample(src: Float32Array, srcRate: number, dstRate: number): Float32Array;
  freqToPair(freq: number, N: number, minF?: number, maxF?: number): number;
  rmsToPair(rms: number, N: number, maxRms?: number): number;
  tiltToPair(gamma: number, N: number): number;
  processInput(input: Float32Array): Float32Array;
  start(): Promise<boolean>;
  stop(): void;
  sample(): import('./types.js').VoiceSample | null;
  startRelay(forceMode?: string): Promise<boolean>;
  stopRelay(): void;
  playRelay(bytes: ArrayBuffer, meta?: any): void;
  ensureOrientationPermission(): Promise<boolean>;
  ctx: AudioContext | null;
  relayMode: 'worklet' | 'script' | null;
  relayError: string | null;
  relayDataCount: number;
  workingRelayMode: string | null;
  onRelayChunk: ((input: Float32Array) => void) | null;
}

declare var AudioSys: AudioSysApi;
declare var Board: BoardApi;
declare var Voice: VoiceApi;
declare var PixelBG: PixelBGApi;

/** 倾斜画线：deviceorientation 注入的倾角（input.js 写入） */
declare interface Window {
  __gamma?: number;
  HomeScene?: HomeSceneApi;
}
