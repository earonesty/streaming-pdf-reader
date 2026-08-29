export interface Type1Stem {
  orientation: "horizontal" | "vertical";
  position: number;
  width: number;
}

export type Type2Event =
  | { operator: number | [number, number]; values: number[] }
  | { activeStems: Set<Type1Stem> };

export function encodeType2CharString(
  width: number,
  stems: Type1Stem[],
  initialStems: Set<Type1Stem>,
  events: Type2Event[],
  scale: number,
): Uint8Array {
  const factor = scale * 1000;
  const output: number[] = [];
  const number = (value: number) => output.push(...encodeNumber(value * factor));
  number(width);
  const ordered = [
    ...stems.filter((stem) => stem.orientation === "horizontal"),
    ...stems.filter((stem) => stem.orientation === "vertical"),
  ];
  let firstDeclaration = true;
  for (const orientation of ["horizontal", "vertical"] as const) {
    const selected = ordered.filter((stem) => stem.orientation === orientation);
    let previousEdge = 0;
    let offset = 0;
    while (offset < selected.length) {
      const count = Math.min(firstDeclaration ? 23 : 24, selected.length - offset);
      for (const stem of selected.slice(offset, offset + count)) {
        number(stem.position - previousEdge);
        number(stem.width);
        previousEdge = stem.position + stem.width;
      }
      output.push(orientation === "horizontal" ? 1 : 3);
      firstDeclaration = false;
      offset += count;
    }
  }
  const masks = events.some((event) => "activeStems" in event);
  const emitMask = (active: Set<Type1Stem>) => {
    output.push(19);
    for (let offset = 0; offset < ordered.length; offset += 8) {
      let byte = 0;
      for (let bit = 0; bit < 8 && offset + bit < ordered.length; bit += 1)
        if (active.has(ordered[offset + bit] as Type1Stem)) byte |= 0x80 >> bit;
      output.push(byte);
    }
  };
  if (masks) emitMask(initialStems);
  for (const event of events) {
    if ("activeStems" in event) {
      emitMask(event.activeStems);
      continue;
    }
    for (const value of event.values) number(value);
    output.push(...(typeof event.operator === "number" ? [event.operator] : event.operator));
  }
  const last = events.at(-1);
  if (!last || "activeStems" in last || last.operator !== 14) output.push(14);
  return Uint8Array.from(output);
}

function encodeNumber(value: number): number[] {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 1e-6) {
    const fixed = Math.round(value * 65_536);
    return [255, fixed >>> 24, (fixed >>> 16) & 0xff, (fixed >>> 8) & 0xff, fixed & 0xff];
  }
  if (rounded >= -107 && rounded <= 107) return [rounded + 139];
  if (rounded >= 108 && rounded <= 1131)
    return [247 + ((rounded - 108) >> 8), (rounded - 108) & 0xff];
  if (rounded >= -1131 && rounded <= -108) {
    const magnitude = -rounded - 108;
    return [251 + (magnitude >> 8), magnitude & 0xff];
  }
  return [28, (rounded >> 8) & 0xff, rounded & 0xff];
}
