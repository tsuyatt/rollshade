export interface Live {
  update(dt: number): boolean;
  dispose?(): void;
}

interface Task {
  at: number;
  fn: () => void;
  owner: object | null;
  part: string;
  dead?: boolean;
}

interface Entry {
  live: Live;
  owner: object | null;
  part: string;
  dead: boolean;
}

export class Scheduler {
  time = 0;
  part = 'main';
  private tasks: Task[] = [];
  private due: Task[] = [];
  private lives: Entry[] = [];
  private stepping = false;

  after(delay: number, fn: () => void, owner: object | null = null): void {
    this.tasks.push({ at: this.time + Math.max(delay, 0), fn, owner, part: this.part });
  }

  add(live: Live, owner: object | null = null): Live {
    this.lives.push({ live, owner, part: this.part, dead: false });
    return live;
  }

  during(delay: number, dur: number, fn: (k: number, dt: number, age: number) => void, end?: () => void, owner: object | null = null): void {
    this.after(
      delay,
      () => {
        let age = 0;
        fn(0, 0, 0);
        this.add(
          {
            update: (dt) => {
              age += dt;
              const k = Math.min(age / dur, 1);
              fn(k, dt, age);
              if (k >= 1) {
                end?.();
                return false;
              }
              return true;
            },
          },
          owner,
        );
      },
      owner,
    );
  }

  step(dt: number): void {
    if (this.stepping) return;
    this.time += dt;
    this.stepping = true;
    let next = 0;
    try {
      for (let guard = 0; guard < 8; guard++) {
        const due = this.tasks.filter((t) => t.at <= this.time);
        if (due.length === 0) break;
        this.tasks = this.tasks.filter((t) => t.at > this.time);
        due.sort((a, b) => a.at - b.at);
        this.due = due;
        for (next = 0; next < due.length; ) {
          const t = due[next++];
          if (t.dead) continue;
          this.part = t.part;
          t.fn();
        }
        this.due = [];
      }
      const lives = this.lives;
      for (let i = lives.length - 1; i >= 0; i--) {
        const entry = lives[i];
        if (entry.dead) continue;
        this.part = entry.part;
        let keep = false;
        try {
          keep = entry.live.update(dt);
        } finally {
          if (!keep && !entry.dead) {
            entry.dead = true;
            entry.live.dispose?.();
          }
        }
      }
    } finally {
      for (let i = next; i < this.due.length; i++) if (!this.due[i].dead) this.tasks.push(this.due[i]);
      this.due = [];
      this.stepping = false;
      this.part = 'main';
      this.sweep();
    }
  }

  private sweep(): void {
    const lives = this.lives;
    let n = 0;
    for (let i = 0; i < lives.length; i++) if (!lives[i].dead) lives[n++] = lives[i];
    lives.length = n;
  }

  busy(owner: object): boolean {
    return this.tasks.some((t) => t.owner === owner) || this.lives.some((l) => !l.dead && l.owner === owner);
  }

  cancel(owner: object | null = null): void {
    this.tasks = owner ? this.tasks.filter((t) => t.owner !== owner) : [];
    for (const t of this.due) if (!owner || t.owner === owner) t.dead = true;
    const lives = this.lives;
    for (let i = lives.length - 1; i >= 0; i--) {
      const entry = lives[i];
      if (entry.dead || (owner && entry.owner !== owner)) continue;
      entry.dead = true;
      entry.live.dispose?.();
    }
    if (!this.stepping) this.sweep();
  }
}
