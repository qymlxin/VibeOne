export type Disposer = () => void | Promise<void>;

/** Owns resources independently from OS processes and individual RPC calls. */
export class Scope {
  readonly #disposers = new Set<Disposer>();
  #disposed = false;
  #disposing?: Promise<void>;

  add(dispose: Disposer): Disposer {
    if (this.#disposed) throw new Error('Scope is disposed');
    let active = true;
    const once = async () => {
      if (!active) return;
      active = false;
      this.#disposers.delete(once);
      await dispose();
    };
    this.#disposers.add(once);
    return once;
  }

  dispose(): Promise<void> {
    return this.#disposing ??= this.#dispose();
  }

  async #dispose(): Promise<void> {
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const dispose of [...this.#disposers].reverse()) {
      try { await dispose(); } catch (error) { errors.push(error); }
    }
    this.#disposers.clear();
    if (errors.length) throw new AggregateError(errors, 'Resource cleanup failed');
  }
}

export interface Owner { instanceId: string; generation: number }

/** A stale disposer must never unregister a newer generation's replacement. */
export class Registry<T> {
  readonly #entries = new Map<string, { owner: Owner; value: T }>();

  register(id: string, owner: Owner, value: T): Disposer {
    const entry = { owner: { ...owner }, value };
    if (this.#entries.has(id)) throw new Error(`Contribution already registered: ${id}`);
    this.#entries.set(id, entry);
    return () => {
      if (this.#entries.get(id) === entry) this.#entries.delete(id);
    };
  }

  get(id: string): T | undefined { return this.#entries.get(id)?.value; }

  removeOwner(owner: Owner): void {
    for (const [id, entry] of this.#entries) {
      if (entry.owner.instanceId === owner.instanceId && entry.owner.generation === owner.generation) {
        this.#entries.delete(id);
      }
    }
  }
}
