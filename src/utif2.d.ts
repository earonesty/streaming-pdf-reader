declare module "utif2" {
  interface Ifd {
    width?: number;
    height?: number;
    data?: Uint8Array;
  }

  const UTIF: {
    decode(buffer: ArrayBuffer): Ifd[];
    decodeImage(buffer: ArrayBuffer, ifd: Ifd): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  };

  export default UTIF;
}
