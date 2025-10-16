import fs from "fs/promises"

import zlib from "zlib"
import sharp from "sharp";

const indexedPallette: {[key: number]: number} = {
  0: 0,
  4278190080: 1,
  4278823670: 2,
  4279763040: 3,
  4279917796: 4,
  4280159909: 5,
  4280556781: 6,
  4280778751: 7,
  4280969365: 8,
  4281435292: 9,
  4281445829: 10,
  4281615976: 11,
  4282018634: 12,
  4282113529: 13,
  4282137660: 14,
  4282344557: 15,
  4282464563: 16,
  4282995355: 17,
  4283077722: 18,
  4283531473: 19,
  4283589499: 20,
  4284415879: 21,
  4284470504: 22,
  4284720347: 23,
  4285053198: 24,
  4285236380: 25,
  4285238420: 26,
  4285432076: 27,
  4285694202: 28,
  4285777284: 29,
  4286034680: 30,
  4286085240: 31,
  4286087377: 32,
  4286185675: 33,
  4286309907: 34,
  4286586860: 35,
  4286857802: 36,
  4287460717: 37,
  4287935958: 38,
  4288220280: 39,
  4288565288: 40,
  4288641295: 41,
  4288984826: 42,
  4289054207: 43,
  4289113616: 44,
  4289302003: 45,
  4289374890: 46,
  4290261325: 47,
  4290328746: 48,
  4290575103: 49,
  4290699539: 50,
  4291064186: 51,
  4291934643: 52,
  4292006610: 53,
  4293169984: 54,
  4294028981: 55,
  4294113120: 56,
  4294113979: 57,
  4294332523: 58,
  4294549472: 59,
  4294685081: 60,
  4294952829: 61,
  4294967295: 62
}

const indexedPalletteInv: {[key: number]: number} = [
  0,
  4278190080,
  4278823670,
  4279763040,
  4279917796,
  4280159909,
  4280556781,
  4280778751,
  4280969365,
  4281435292,
  4281445829,
  4281615976,
  4282018634,
  4282113529,
  4282137660,
  4282344557,
  4282464563,
  4282995355,
  4283077722,
  4283531473,
  4283589499,
  4284415879,
  4284470504,
  4284720347,
  4285053198,
  4285236380,
  4285238420,
  4285432076,
  4285694202,
  4285777284,
  4286034680,
  4286085240,
  4286087377,
  4286185675,
  4286309907,
  4286586860,
  4286857802,
  4287460717,
  4287935958,
  4288220280,
  4288565288,
  4288641295,
  4288984826,
  4289054207,
  4289113616,
  4289302003,
  4289374890,
  4290261325,
  4290328746,
  4290575103,
  4290699539,
  4291064186,
  4291934643,
  4292006610,
  4293169984,
  4294028981,
  4294113120,
  4294113979,
  4294332523,
  4294549472,
  4294685081,
  4294952829,
  4294967295
]

export type PNGBuffer = Buffer;

async function pngBufferToUint32Array(buffer: PNGBuffer): Promise<{uint32: Uint32Array, width: number, height: number}> {
  const { data, info } = await sharp(buffer)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const uint32 = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
  return { uint32, width: info.width, height: info.height };
}

async function uint32ArrayToPNGBuffer(buf32: Uint32Array, width: number, height: number): Promise<Buffer> {
  return await sharp(new Uint8Array(buf32.buffer), {
    raw: {
      width,
      height,
      channels: 4
    }
  }).png().toBuffer();
}

export class DPNGFile {
  data:   Buffer;
  width:  number;
  height: number;
  count:  number;

  constructor(data: Buffer, width: number, height: number, count: number) {
    this.data = data;
    this.width  = width;
    this.height = height;
    this.count  = count;
  }

  // returns buffer/png
  async apply(image: PNGBuffer) {
    try {
      const { uint32: buf32, width, height } = await pngBufferToUint32Array(image);
      const payload = zlib.inflateSync(this.data);

      let i = 0, prevIdx = 0;

      for (let n = 0; n < this.count; n++) {
          let delta = payload[i++];
          if (delta === 0xFF) {
              delta = payload[i] | (payload[i+1] << 8) | (payload[i+2] << 16) | (payload[i+3] << 24);
              i += 4;
          }

          const idx = prevIdx + delta;
          const color = indexedPalletteInv[payload[i++]];

          buf32[idx] = color;
          prevIdx = idx;
      }

      return await uint32ArrayToPNGBuffer(buf32, width, height);
    } catch (e) {
      console.log(e);
      return null;
    }
  }

  // returns raw data
  async applyRaw(image: Buffer) {
    try {
      const buf32 = new Uint32Array(image.buffer, image.byteOffset, image.length >> 2);
      const payload = zlib.inflateSync(this.data);

      let i = 0, prevIdx = 0;

      for (let n = 0; n < this.count; n++) {
          let delta = payload[i++];
          if (delta === 0xFF) {
              delta = payload[i] | (payload[i+1] << 8) | (payload[i+2] << 16) | (payload[i+3] << 24);
              i += 4;
          }

          const idx = prevIdx + delta;
          const color = indexedPalletteInv[payload[i++]];

          buf32[idx] = color;
          prevIdx = idx;
      }

      return Buffer.from(buf32.buffer);
    } catch (e) {
      console.log(e);
      return null;
    }
  }

  async getImage() {
    const payload = zlib.inflateSync(this.data);

    const image = Buffer.alloc(this.width*this.height*4)
    const data32 = new Uint32Array(image.buffer, image.byteOffset, image.length >> 2);
    let i = 0, prevIdx = 0;

    for (let n = 0; n < this.count; n++) {
      let delta = payload[i++];
      if (delta === 0xFF) {
        delta = payload[i] | (payload[i+1]<<8) | (payload[i+2]<<16) | (payload[i+3]<<24);
        i += 4;
      }

      const idx = prevIdx + delta;
      const color = indexedPalletteInv[payload[i++]];

      data32[idx] = color;
      prevIdx = idx;
    }
    return await uint32ArrayToPNGBuffer(data32, this.width, this.height);
  }
}

export async function getChanges(imgA: PNGBuffer, imgB: PNGBuffer, width: number, height: number) {
  try {
    const { uint32: a32 } = await pngBufferToUint32Array(imgA);
    const { uint32: b32 } = await pngBufferToUint32Array(imgB);

    const changes = [];

    for (let i = 0; i < a32.length; i++) {
      const color = b32[i];
      if (a32[i] !== color) {
        const x = i % width;
        const y = (i / width) | 0;
        const idx = y * width + x;

        changes.push({idx, color: indexedPallette[color]});
      }
    }
    return changes;
  } catch (e) {
    console.log(e);
    return [];
  }
}

export async function writeDPNG(changes: {idx: number, color: number}[], width: number, height: number, path: string) {
  const payload = [];
  let prevIdx = 0;

  for (let i = 0; i < changes.length; i++) {
    const { idx, color } = changes[i];
    let delta = idx - prevIdx;

    if (delta < 0xFF) {
      payload.push(delta);
    } else {
      payload.push(0xFF);
      payload.push(delta & 0xFF, (delta >> 8) & 0xFF, (delta >> 16) & 0xFF, (delta >> 24) & 0xFF);
    }

    payload.push(color);
    prevIdx = idx;
  }

  const buf = Buffer.from(payload);
  const compressed = zlib.deflateSync(buf, { level: 5 });

  const header = Buffer.alloc(16);
  header.write('DPCH', 0);
  header.writeUInt32LE(width, 4);
  header.writeUInt32LE(height, 8);
  header.writeUInt32LE(changes.length, 12);

  await fs.writeFile(path, Buffer.concat([header, compressed]));

  return compressed.byteLength + 24;
}

export async function readDPNG(filePath: string) {
  const fileBuf = await fs.readFile(filePath);

  const width  = fileBuf.readUInt32LE(4);
  const height = fileBuf.readUInt32LE(8);
  const count  = fileBuf.readUInt32LE(12);

  const data  = fileBuf.subarray(16);

  return new DPNGFile(data, width, height, count);
}