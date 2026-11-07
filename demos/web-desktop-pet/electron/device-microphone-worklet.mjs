class ControlMicrophone extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(320); this.used = 0 }
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) for (const value of channel) {
      this.block[this.used++] = value
      if (this.used === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer])
        this.block = new Float32Array(320); this.used = 0
      }
    }
    return true
  }
}
registerProcessor('control-microphone', ControlMicrophone)
