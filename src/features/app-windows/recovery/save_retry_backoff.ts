const firstDelay = 5_000;
const longestDelay = 300_000;

export class SaveRetryBackoff {
  private timer?: ReturnType<typeof setTimeout>;
  private delay = firstDelay;
  private failing = false;
  private readonly focused = () => {
    if (this.failing) this.run();
  };
  constructor(private retry: () => Promise<void>) {
    window.addEventListener("focus", this.focused);
  }
  update(failed: number) {
    const wasFailing = this.failing;
    this.failing = failed > 0;
    if (!this.failing) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.delay = firstDelay;
    } else if (!wasFailing || !this.timer) this.schedule();
  }
  dispose() {
    clearTimeout(this.timer);
    window.removeEventListener("focus", this.focused);
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), this.delay);
    this.delay = Math.min(this.delay * 2, longestDelay);
  }
  private run() {
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.retry()
      .catch(() => undefined)
      .finally(() => {
        if (this.failing && !this.timer) this.schedule();
      });
  }
}
