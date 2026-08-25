import { writeHtmlDocument } from "@boxpdf/html-writer";
import { httpSource, openPdf } from "@boxpdf/reader";

export async function pdfUrlToHtmlResponse(pdfUrl: URL): Promise<Response> {
  const source = await httpSource(pdfUrl);
  const reader = await openPdf(source);
  const encoder = new TextEncoder();
  const output = new TransformStream<Uint8Array, Uint8Array>();
  const writer = output.writable.getWriter();

  void (async () => {
    try {
      await writeHtmlDocument(reader.pages(), (chunk) => writer.write(encoder.encode(chunk)));
      await writer.close();
    } catch (error) {
      await writer.abort(error);
    } finally {
      reader.close();
    }
  })();

  return new Response(output.readable, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
