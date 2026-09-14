// SPDX-License-Identifier: MPL-2.0
// Mutations invalidate an in-flight read; passive polling joins it. Every
// caller waits for a current result, and a busy backend gets a bounded retry.
export function createRefreshQueue({load, apply, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, timeout = 8000}) {
  let version = 0, running = false, disposed = false;
  let waiters = [];
  const finish = (error) => {
    const current = waiters;
    waiters = [];
    for (const waiter of current) error ? waiter.reject(error) : waiter.resolve();
  };
  async function drain() {
    if (running || disposed) return;
    running = true;
    let busySince;
    try {
      while (waiters.length && !disposed) {
        const requested = version;
        let next;
        try { next = await load(); }
        catch (error) { if(requested !== version)continue; throw error; }
        if (disposed) break;
        if (next.layoutBusy) {
          busySince ??= now();
          if (now() - busySince >= timeout) throw Error('Tabs are still changing. Try again.');
          await pause(80);
          continue;
        }
        if (requested !== version) continue;
        busySince = undefined;
        apply(next);
        if (requested === version) finish();
      }
    } catch (error) {
      finish(error);
    } finally {
      running = false;
      if (waiters.length && !disposed) drain();
    }
  }
  return {
    request({passive = false} = {}) {
      if (disposed) return Promise.resolve();
      if (!passive || !running) version++;
      const result = new Promise((resolve, reject) => waiters.push({resolve, reject}));
      drain();
      return result;
    },
    dispose() { disposed = true; finish(); },
  };
}
