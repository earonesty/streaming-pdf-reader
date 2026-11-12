export function joinText(previous: string, next: string): string {
  if (/[-‐‑]$/u.test(previous)) {
    const terminal = /([^\s]+)[-‐‑]$/u.exec(previous)?.[1] ?? "";
    const lexicalHyphen = /[-‐‑\d]/u.test(terminal);
    return lexicalHyphen
      ? `${previous}${next.trimStart()}`
      : `${previous.slice(0, -1)}${next.trimStart()}`;
  }
  if (/\S{20,}$/u.test(previous) && /^[a-z]{1,4}[.,;:]?$/u.test(next.trim())) {
    return `${previous}${next.trim()}`;
  }
  return `${previous.trimEnd()} ${next.trimStart()}`;
}
