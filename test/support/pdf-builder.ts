export function buildPdfObjects(objects: Array<string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.7\n")];
  const offsets = [0];
  let length = chunks[0]?.length ?? 0;
  objects.forEach((object, index) => {
    offsets[index + 1] = length;
    const prefix = encoder.encode(`${index + 1} 0 obj\n`);
    const body = typeof object === "string" ? encoder.encode(object) : object;
    const suffix = encoder.encode("\nendobj\n");
    chunks.push(prefix, body, suffix);
    length += prefix.length + body.length + suffix.length;
  });
  const xref = length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1)
    trailer += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  chunks.push(encoder.encode(trailer));
  return concatenate(chunks);
}

export function streamObject(bytes: Uint8Array, dictionary = ""): Uint8Array {
  return concatenate([
    new TextEncoder().encode(
      `<< /Length ${bytes.length}${dictionary ? ` ${dictionary}` : ""} >>\nstream\n`,
    ),
    bytes,
    new TextEncoder().encode("\nendstream"),
  ]);
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
