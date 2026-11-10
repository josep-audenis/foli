/**
 * The zip container of a `.docx`, on the platform's `DecompressionStream`/`CompressionStream`
 * ("deflate-raw": browsers, workers, Node 20.12+); no dependency.
 *
 * Reading keeps every entry's compressed bytes as they are in the file, so writing copies an
 * untouched entry verbatim: its data is the original byte for byte, never recompressed. Only
 * replaced entries are compressed again.
 */

/** A file in the zip. `raw` is its data as stored (compressed when `method` is 8). */
export interface ZipEntry {
  readonly name: string;
  /** The name's bytes as stored, written back unchanged. */
  readonly nameBytes: Uint8Array;
  /** 0 stored, 8 deflated. */
  readonly method: 0 | 8;
  /** General purpose flags; only the UTF-8 name bit (11) is written back. */
  readonly flags: number;
  /** DOS time and date. */
  readonly time: number;
  readonly date: number;
  readonly crc32: number;
  /** Uncompressed size. */
  readonly size: number;
  readonly raw: Uint8Array;
  /**
   * As read: the local header (with name and extra field), the data descriptor if any, and the
   * central directory record, written back unchanged while `raw` is the data read with them.
   */
  readonly stored?: {
    readonly local: Uint8Array;
    readonly descriptor: Uint8Array;
    readonly central: Uint8Array;
  };
}

export interface ZipLimits {
  /** Most entries accepted. Default 10 000. */
  readonly maxEntries?: number;
  /** Most bytes accepted once uncompressed, all entries together. Default 512 MiB. */
  readonly maxSize?: number;
}

/** A file that is not a zip Foli can read, or is damaged. */
export class ZipError extends Error {
  override name = "ZipError";
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DESCRIPTOR = 0x08074b50;
const UTF8_NAME = 0x0800;
const textDecoder = new TextDecoder();

/**
 * Lists the entries of a zip from its central directory, in the directory's order. Nothing is
 * decompressed: see {@link inflateEntry}. Every entry is checked against its local header, and
 * entries may not overlap: Foli reads what any other zip reader would.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 10_000;
  const maxSize = limits.maxSize ?? 512 * 1024 * 1024;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw new ZipError("Multi-disk zip archives are not supported");
  }
  const count = view.getUint16(end + 10, true);
  const dirSize = view.getUint32(end + 12, true);
  const dirOffset = view.getUint32(end + 16, true);
  // shortcut: no ZIP64 (Word writes it only past 4 GiB or 65 535 entries); add if a real file needs it.
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    throw new ZipError("ZIP64 archives are not supported");
  }
  if (count > maxEntries) throw new ZipError(`Too many entries: ${count} (limit ${maxEntries})`);

  const entries: ZipEntry[] = [];
  const spans: { start: number; end: number; name: string }[] = [];
  const seen = new Set<string>();
  let total = 0;
  let at = dirOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) {
      throw new ZipError("Damaged zip: bad central directory record");
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc32 = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const recordLength =
      46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    if (at + recordLength > end) throw new ZipError("Damaged zip: bad central directory record");
    const central = bytes.subarray(at, at + recordLength);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    // shortcut: names without the UTF-8 flag (CP437) are read as UTF-8, right for ASCII, which
    // part names are; the bytes are written back unchanged either way.
    const name = textDecoder.decode(nameBytes);
    at += recordLength;

    if (flags & 0x41) throw new ZipError(`Encrypted entry: ${name}`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) {
      throw new ZipError("ZIP64 archives are not supported");
    }
    if (method !== 0 && method !== 8) {
      throw new ZipError(`Unsupported compression method ${method}: ${name}`);
    }
    // Deflate expands at most 1032 times: a larger declared size is a lie meant to make the
    // reader allocate it.
    if (method === 0 ? size !== compressedSize : size > compressedSize * 1032 + 1024) {
      throw new ZipError(`Damaged zip: impossible size for ${name}`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw new ZipError(`Duplicate entry: ${name}`);
    seen.add(key);
    total += size;
    if (total > maxSize) throw new ZipError(`Too large once uncompressed (limit ${maxSize} bytes)`);

    if (local + 30 > dirOffset || view.getUint32(local, true) !== LOCAL) {
      throw new ZipError(`Damaged zip: no local header for ${name}`);
    }
    const localNameLength = view.getUint16(local + 26, true);
    // The data follows the local header, whose extra field may differ from the central record's.
    const data = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (data + compressedSize > dirOffset) {
      throw new ZipError(`Damaged zip: data out of range for ${name}`);
    }
    const mismatch = () =>
      new ZipError(`Damaged zip: local header does not match the directory for ${name}`);
    if (
      view.getUint16(local + 8, true) !== method ||
      !equalBytes(bytes.subarray(local + 30, local + 30 + localNameLength), nameBytes)
    ) {
      throw mismatch();
    }
    // A data descriptor (flag 3) follows the data with the CRC and sizes, with or without a
    // signature; the local header then may hold zeros. Either way they must agree.
    let descriptorLength = 0;
    let check = local + 14;
    if (flags & 0x08) {
      const after = data + compressedSize;
      const signed = after + 4 <= dirOffset && view.getUint32(after, true) === DESCRIPTOR;
      descriptorLength = signed ? 16 : 12;
      if (after + descriptorLength > dirOffset) {
        throw new ZipError(`Damaged zip: no data descriptor for ${name}`);
      }
      check = signed ? after + 4 : after;
    }
    if (
      view.getUint32(check, true) !== crc32 ||
      view.getUint32(check + 4, true) !== compressedSize ||
      view.getUint32(check + 8, true) !== size
    ) {
      throw mismatch();
    }
    const stop = data + compressedSize + descriptorLength;
    spans.push({ start: local, end: stop, name });
    entries.push({
      name,
      nameBytes,
      method,
      flags,
      time,
      date,
      crc32,
      size,
      raw: bytes.subarray(data, data + compressedSize),
      stored: {
        local: bytes.subarray(local, data),
        descriptor: bytes.subarray(data + compressedSize, stop),
        central,
      },
    });
  }
  if (at !== dirOffset + dirSize) {
    throw new ZipError("Damaged zip: central directory size mismatch");
  }
  // Overlapping entries share data: another reader could see other content, and a small file
  // could expand without limit.
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const span = spans[i] as (typeof spans)[number];
    if (span.start < (spans[i - 1] as (typeof spans)[number]).end) {
      throw new ZipError(`Damaged zip: ${span.name} overlaps another entry`);
    }
  }
  return entries;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The end record: the last one whose central directory is where it says (not one in a comment). */
function findEnd(view: DataView): number {
  // The end record is 22 bytes plus a comment of at most 65 535.
  const last = view.byteLength - 22;
  for (let at = last; at >= 0 && at >= last - 0xffff; at--) {
    if (view.getUint32(at, true) !== END) continue;
    if (at + 22 + view.getUint16(at + 20, true) > view.byteLength) continue;
    const count = view.getUint16(at + 10, true);
    const dirSize = view.getUint32(at + 12, true);
    const dirOffset = view.getUint32(at + 16, true);
    // ZIP64 and multi-disk archives: accepted here to be refused by name.
    const special =
      count === 0xffff ||
      dirOffset === 0xffffffff ||
      view.getUint16(at + 4, true) !== 0 ||
      view.getUint16(at + 6, true) !== 0;
    // The directory ends where the end record starts (no ZIP64 records in between).
    const directory =
      dirOffset + dirSize === at && (count === 0 || view.getUint32(dirOffset, true) === CENTRAL);
    if (special || directory) return at;
  }
  const head = view.byteLength >= 4 ? view.getUint32(0, false) : 0;
  // Compound File Binary: an encrypted .docx, or a .doc.
  if (head === 0xd0cf11e0) {
    throw new ZipError("Not a zip: an encrypted document or a legacy .doc (Compound File)");
  }
  throw new ZipError("Not a zip archive");
}

/** The entry's data, decompressed, checked against its size and CRC-32. */
export async function inflateEntry(entry: ZipEntry): Promise<Uint8Array> {
  const data =
    entry.method === 0 ? entry.raw.slice() : await inflateRaw(entry.raw, entry.size, entry.name);
  if (data.length !== entry.size) throw new ZipError(`Damaged zip: wrong size for ${entry.name}`);
  if (crc32(data) !== entry.crc32)
    throw new ZipError(`Damaged zip: CRC mismatch for ${entry.name}`);
  return data;
}

async function inflateRaw(raw: Uint8Array, size: number, name: string): Promise<Uint8Array> {
  // Collected as it comes, not allocated from the declared size.
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = streamOf(raw).pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Never past the declared size: a zip bomb stops here.
      if (length + value.length > size) throw new ZipError(`Damaged zip: wrong size for ${name}`);
      chunks.push(value);
      length += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ZipError) throw error;
    throw new ZipError(`Damaged zip: cannot decompress ${name}`);
  }
  if (length !== size) throw new ZipError(`Damaged zip: wrong size for ${name}`);
  return concat(chunks);
}

/**
 * A new deflated entry holding `data`. With `like` (the entry it replaces) it keeps that entry's
 * name bytes, name encoding flag, time and date.
 */
export async function deflateEntry(
  name: string,
  data: Uint8Array,
  like?: Pick<ZipEntry, "time" | "date" | "nameBytes" | "flags">,
): Promise<ZipEntry> {
  const chunks: Uint8Array[] = [];
  const reader = streamOf(data).pipeThrough(new CompressionStream("deflate-raw")).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return {
    name,
    nameBytes: like?.nameBytes ?? new TextEncoder().encode(name),
    method: 8,
    flags: like ? like.flags & UTF8_NAME : UTF8_NAME,
    time: like?.time ?? 0,
    // 1980-01-01, the earliest DOS date, when there is no entry to take it from.
    date: like?.date ?? 0x21,
    crc32: crc32(data),
    size: data.length,
    raw: concat(chunks),
  };
}

/**
 * The zip of `entries`, in order; each entry's data written as it is in `raw`. An entry read
 * from a zip keeps its headers byte for byte (only its offset in the directory changes), so a
 * zip written back with its entries unchanged is the same file, short of a trailing comment.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.stored) {
      const { local, descriptor } = entry.stored;
      const central = entry.stored.central.slice();
      new DataView(central.buffer).setUint32(42, offset, true);
      parts.push(local, entry.raw, descriptor);
      directory.push(central);
      offset += local.length + entry.raw.length + descriptor.length;
      continue;
    }
    const flags = entry.flags & UTF8_NAME;
    const local = new Uint8Array(30 + entry.nameBytes.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, LOCAL, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, flags, true);
    l.setUint16(8, entry.method, true);
    l.setUint16(10, entry.time, true);
    l.setUint16(12, entry.date, true);
    l.setUint32(14, entry.crc32, true);
    l.setUint32(18, entry.raw.length, true);
    l.setUint32(22, entry.size, true);
    l.setUint16(26, entry.nameBytes.length, true);
    local.set(entry.nameBytes, 30);

    const central = new Uint8Array(46 + entry.nameBytes.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, CENTRAL, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, flags, true);
    c.setUint16(10, entry.method, true);
    c.setUint16(12, entry.time, true);
    c.setUint16(14, entry.date, true);
    c.setUint32(16, entry.crc32, true);
    c.setUint32(20, entry.raw.length, true);
    c.setUint32(24, entry.size, true);
    c.setUint16(28, entry.nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.set(entry.nameBytes, 46);

    parts.push(local, entry.raw);
    directory.push(central);
    offset += local.length + entry.raw.length;
  }
  if (entries.length > 0xfffe || offset > 0xfffffffe) {
    throw new ZipError("Too large for a zip without ZIP64");
  }
  const dirSize = directory.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, END, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);
  return concat([...parts, ...directory, end]);
}

function streamOf(data: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      // Never a SharedArrayBuffer here: the bytes come from slices and encoders.
      controller.enqueue(data as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

let table: Uint32Array | undefined;

/** CRC-32 (IEEE), as zip stores it. */
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (table[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
