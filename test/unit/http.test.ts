import { afterEach, describe, expect, it, vi } from "vitest";
import { httpSource } from "../../src/http.js";

afterEach(() => vi.unstubAllGlobals());

describe("httpSource", () => {
  it("probes and performs ETag-guarded range reads", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return requests.length === 1
        ? response([1], 206, { "content-range": "bytes 0-0/4", etag: '"v1"' })
        : response([20, 30], 206, { "content-range": "bytes 1-2/4", etag: '"v1"' });
    });
    const source = await httpSource("https://example.test/file.pdf", {
      fetch: fetcher,
      headers: { authorization: "Bearer test" },
    });
    expect(source.size).toBe(4);
    await expect(source.read(1, 2)).resolves.toEqual(Uint8Array.of(20, 30));
    await expect(source.read(4, 0)).resolves.toEqual(new Uint8Array());
    const headers = new Headers(requests[1]?.headers);
    expect(headers.get("range")).toBe("bytes=1-2");
    expect(headers.get("if-range")).toBe('"v1"');
    expect(headers.get("authorization")).toBe("Bearer test");
  });

  it("uses global fetch by default", async () => {
    const fetcher = vi.fn(async () => response([0], 206, { "content-range": "bytes 0-0/1" }));
    vi.stubGlobal("fetch", fetcher);
    const source = await httpSource(new URL("https://example.test/default.pdf"));
    expect(source.size).toBe(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([[response([], 500)], [response([], 206, { "content-range": "invalid" })]])(
    "rejects an invalid range probe",
    async (probe) => {
      await expect(
        httpSource("https://example.test/file.pdf", { fetch: vi.fn(async () => probe) }),
      ).rejects.toThrow("must support byte ranges");
    },
  );

  it("uses bounded slices when the probe returns a complete response", async () => {
    const warning = vi.fn();
    let calls = 0;
    const source = await httpSource("https://example.test/file.pdf", {
      onWarning: warning,
      fetch: vi.fn(async () => {
        calls += 1;
        return response([10, 20, 30, 40], 200, { "content-length": "4" });
      }),
    });
    expect(source.size).toBe(4);
    await expect(source.read(1, 2)).resolves.toEqual(Uint8Array.of(20, 30));
    expect(calls).toBe(2);
    expect(warning).toHaveBeenCalledOnce();
  });

  it("counts a streamed full probe when Content-Length is unavailable", async () => {
    const source = await httpSource("https://example.test/file.pdf", {
      onWarning: vi.fn(),
      fetch: vi.fn(async () => response([10, 20, 30], 200)),
    });
    expect(source.size).toBe(3);
    await expect(source.read(2, 1)).resolves.toEqual(Uint8Array.of(30));
  });

  it("accepts and warns once when range reads over-return a complete response", async () => {
    const warning = vi.fn();
    let calls = 0;
    const source = await httpSource("https://example.test/file.pdf", {
      onWarning: warning,
      fetch: vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? response([0], 206, { "content-range": "bytes 0-0/5" })
          : response([10, 20, 30, 40, 50], 200);
      }),
    });
    await expect(source.read(2, 2)).resolves.toEqual(Uint8Array.of(30, 40));
    await expect(source.read(4, 1)).resolves.toEqual(Uint8Array.of(50));
    expect(warning).toHaveBeenCalledOnce();
  });

  it("rejects a complete response that ends before the requested slice", async () => {
    let calls = 0;
    const source = await httpSource("https://example.test/file.pdf", {
      onWarning: vi.fn(),
      fetch: vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? response([0], 206, { "content-range": "bytes 0-0/5" })
          : response([10, 20], 200);
      }),
    });
    await expect(source.read(3, 1)).rejects.toThrow("needed 4");
  });

  it("rejects invalid requested ranges", async () => {
    const source = await httpSource("https://example.test/file.pdf", {
      fetch: vi.fn(async () => response([0], 206, { "content-range": "bytes 0-0/2" })),
    });
    for (const [offset, length] of [
      [-1, 1],
      [0.5, 1],
      [0, -1],
      [0, 0.5],
      [3, 0],
      [1, 2],
    ]) {
      await expect(source.read(offset ?? 0, length ?? 0)).rejects.toThrow(RangeError);
    }
  });

  it("rejects bad range responses and incorrect byte counts", async () => {
    for (const result of [response([], 500), response([1], 206)]) {
      let calls = 0;
      const source = await httpSource("https://example.test/file.pdf", {
        fetch: vi.fn(async () => {
          calls += 1;
          return calls === 1 ? response([0], 206, { "content-range": "bytes 0-0/3" }) : result;
        }),
      });
      await expect(source.read(0, 2)).rejects.toThrow(/range request returned/);
    }
  });

  it("rejects a partial response for a different byte range or entity", async () => {
    for (const result of [
      response([20, 30], 206, { "content-range": "bytes 0-1/4", etag: '"v1"' }),
      response([20, 30], 206, { "content-range": "bytes 1-2/4", etag: '"v2"' }),
    ]) {
      let calls = 0;
      const source = await httpSource("https://example.test/file.pdf", {
        fetch: vi.fn(async () => {
          calls += 1;
          return calls === 1
            ? response([0], 206, { "content-range": "bytes 0-0/4", etag: '"v1"' })
            : result;
        }),
      });
      await expect(source.read(1, 2)).rejects.toThrow(/Content-Range|source changed/);
    }
  });

  it("rejects a full response after an If-Range probe", async () => {
    let calls = 0;
    const source = await httpSource("https://example.test/file.pdf", {
      fetch: vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? response([0], 206, { "content-range": "bytes 0-0/4", etag: '"v1"' })
          : response([10, 20, 30, 40], 200);
      }),
    });

    await expect(source.read(1, 2)).rejects.toThrow("HTTP source changed");
  });

  it("does not send a weak ETag in If-Range", async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return requests.length === 1
        ? response([0], 206, { "content-range": "bytes 0-0/4", etag: 'W/"v1"' })
        : response([10, 20, 30, 40], 200);
    });
    const source = await httpSource("https://example.test/file.pdf", { fetch: fetcher });

    await expect(source.read(1, 2)).resolves.toEqual(Uint8Array.of(20, 30));
    expect(new Headers(requests[1]?.headers).get("if-range")).toBeNull();
  });
});

function response(bytes: number[], status: number, headers?: HeadersInit): Response {
  return new Response(
    Uint8Array.from(bytes),
    headers === undefined ? { status } : { status, headers },
  );
}
