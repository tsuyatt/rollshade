const owners = new WeakMap<object, Record<string, number>>();
let serial = 0;

export function claim(handle: object, slot: string): number {
  const id = ++serial;
  const map = owners.get(handle) ?? {};
  map[slot] = id;
  owners.set(handle, map);
  return id;
}

export function owns(handle: object, slot: string, id: number): boolean {
  return owners.get(handle)?.[slot] === id;
}
