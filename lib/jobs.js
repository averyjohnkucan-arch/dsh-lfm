import { randomUUID } from "node:crypto";

/** One ordered queue for preparation/tuning/GPU work. Scans can run independently. */
export class Jobs {
  constructor(changed = () => {}) {
    this.items = new Map();
    this.tail = Promise.resolve();
    this.changed = changed;
    this.closed = false;
  }

  add(kind, operation, { serial = true } = {}) {
    if (this.closed) throw new Error("Plugin is disabled");
    const job = {
      id: randomUUID(),
      kind,
      status: "queued",
      progress: "Queued",
      log: "",
      controller: new AbortController(),
    };
    this.items.set(job.id, job);
    const run = async () => {
      try {
        job.controller.signal.throwIfAborted();
        job.status = "running";
        job.result = await operation(job.controller.signal, (text, metrics) => {
          const progress = String(text).trim().slice(-500);
          if (progress !== job.progress)
            job.log = (job.log + text + "\n").slice(-30_000);
          job.progress = progress;
          if (metrics !== undefined) job.metrics = { ...metrics };
        });
        job.controller.signal.throwIfAborted();
        job.status = "complete";
        job.progress = "Complete";
      } catch (error) {
        job.status = job.controller.signal.aborted ? "cancelled" : "failed";
        job.error = error.message;
        job.progress = error.message;
      } finally {
        this.changed();
      }
    };
    job.promise = serial ? this.tail.then(run) : run();
    if (serial) this.tail = job.promise;
    // Retain a bounded history without discarding pending jobs or their cancellation handles.
    for (const [id, old] of this.items)
      if (
        this.items.size > 40 &&
        ["complete", "failed", "cancelled"].includes(old.status)
      )
        this.items.delete(id);
    return { id: job.id };
  }

  list() {
    return [...this.items.values()].map(
      ({ controller, promise, ...job }) => job,
    );
  }
  busy() {
    return [...this.items.values()].some((job) =>
      ["queued", "running"].includes(job.status),
    );
  }
  cancel(id) {
    this.items.get(id)?.controller.abort();
  }
  async close() {
    this.closed = true;
    for (const job of this.items.values()) job.controller.abort();
    await Promise.all([...this.items.values()].map((job) => job.promise));
  }
}
