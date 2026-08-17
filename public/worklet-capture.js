/* ============================================================
 * 语音中继采集处理器（AudioWorklet）
 * 从麦克风流累积采样，攒够 4096 点（约 42ms）后发给主线程
 * ============================================================ */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.acc = new Float32Array(2048); // 约 42ms，更平滑的到达节奏
    this.len = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        this.acc[this.len++] = ch[i];
        if (this.len >= this.acc.length) this.post();
      }
    }
    return true;
  }
  post() {
    const copy = this.acc.slice(0, this.len);
    this.port.postMessage(copy);
    this.len = 0;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
