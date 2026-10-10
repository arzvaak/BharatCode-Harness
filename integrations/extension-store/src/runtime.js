/** Runtime instances are keyed by workspace, session and capability; nothing mounts globally. */
export class RuntimeManager {
  constructor(factory, { idleMs = 300000 } = {}) {
    this.factory = factory;
    this.idleMs = idleMs;
    this.enabled = new Map();
    this.instances = new Map();
    this.pending = new Map();
    this.closed = false;
  }
  enable(workspace, entry) {
    if (this.closed) throw Error("Runtime manager closed");
    if (entry.scope !== "session")
      throw Error(
        "This profile-global extension cannot be enabled per workspace",
      );
    this.enabled.set(JSON.stringify([workspace, entry.id]), entry);
  }
  async disable(workspace, id) {
    const key = JSON.stringify([workspace, id]);
    const matches = [...this.instances.values()].filter(
      (x) => x.workspace === workspace && x.id === id,
    );
    if (
      matches.some((x) => x.active || x.leases) ||
      [...this.pending.keys()].some((k) => {
        const [w, , i] = JSON.parse(k);
        return w === workspace && i === id;
      })
    )
      throw Error("Extension has active work");
    this.enabled.delete(key);
    for (const x of matches) {
      await this.closeInstance(x);
    }
  }
  async invoke(workspace, session, entry, tool, args, signal) {
    if (this.closed || !this.enabled.has(JSON.stringify([workspace, entry.id])))
      throw Error("Extension is not enabled in this workspace");
    const key = JSON.stringify([workspace, session, entry.id]);
    let instance = this.instances.get(key);
    if (instance?.closing) {
      await instance.closing;
      return this.invoke(workspace, session, entry, tool, args, signal);
    }
    if (!instance) {
      let pending = this.pending.get(key);
      if (!pending) {
        pending = (async () => {
          const runtime = await this.factory({
            workspace,
            session,
            entry,
            signal,
          });
          if (
            this.closed ||
            !this.enabled.has(JSON.stringify([workspace, entry.id]))
          ) {
            await runtime.dispose();
            throw Error("Activation cancelled");
          }
          const value = {
            key,
            workspace,
            session,
            id: entry.id,
            runtime,
            active: 0,
            leases: 0,
            lastUsed: Date.now(),
          };
          this.instances.set(key, value);
          return value;
        })();
        this.pending.set(key, pending);
      }
      try {
        instance = await pending;
      } finally {
        if (this.pending.get(key) === pending) this.pending.delete(key);
      }
    }
    instance.active++;
    try {
      return await instance.runtime.invoke(tool, args, signal);
    } finally {
      instance.active--;
      instance.lastUsed = Date.now();
    }
  }
  lease(workspace, session, id) {
    const x = this.instances.get(JSON.stringify([workspace, session, id]));
    if (!x || x.closing) throw Error("Runtime not started or closing");
    x.leases++;
    let done = false;
    return () => {
      if (!done) {
        done = true;
        x.leases--;
        x.lastUsed = Date.now();
      }
    };
  }
  async sweep(now = Date.now()) {
    for (const x of [...this.instances.values()])
      if (
        !x.active &&
        !x.leases &&
        !x.runtime.persistent &&
        now - x.lastUsed >= this.idleMs
      ) {
        await this.closeInstance(x);
      }
  }
  closeInstance(x) {
    if (!x.closing) {
      x.closing = Promise.resolve()
        .then(() => x.runtime.dispose())
        .then(() => {
          if (this.instances.get(x.key) === x) this.instances.delete(x.key);
        });
    }
    return x.closing;
  }
  hasWork(id) {
    return (
      [...this.instances.values()].some((x) => x.id === id) ||
      [...this.pending.keys()].some((k) => JSON.parse(k)[2] === id)
    );
  }
  snapshot() {
    return [...this.instances.values()].map(
      ({
        workspace,
        session,
        id,
        active,
        leases,
        lastUsed,
        runtime,
        closing,
      }) => ({
        workspace,
        session,
        id,
        active,
        leases,
        lastUsed,
        persistent: Boolean(runtime.persistent),
        closing: Boolean(closing),
      }),
    );
  }
  async dispose() {
    this.closed = true;
    this.enabled.clear();
    await Promise.allSettled([...this.pending.values()]);
    const items = [...this.instances.values()];
    await Promise.allSettled(items.map((x) => this.closeInstance(x)));
  }
}
