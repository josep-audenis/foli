import { describe, expect, it } from "vitest";
import {
  crc32,
  deflateEntry,
  inflateEntry,
  readZip,
  writeZip,
  type ZipEntry,
  ZipError,
} from "./zip.js";

const encode = (text: string) => new TextEncoder().encode(text);

function storedEntry(name: string, data: Uint8Array): ZipEntry {
  return {
    name,
    nameBytes: encode(name),
    method: 0,
    flags: 0,
    time: 0,
    date: 0x21,
    crc32: crc32(data),
    size: data.length,
    raw: data,
  };
}

async function sample(): Promise<Uint8Array> {
  return writeZip([
    await deflateEntry("a.xml", encode("<a>".repeat(200))),
    storedEntry("media/b.bin", new Uint8Array([1, 2, 3, 4])),
    await deflateEntry("empty.txt", new Uint8Array()),
  ]);
}

/** Offset of the n-th central directory record. */
function central(zip: Uint8Array, n: number): number {
  const view = new DataView(zip.buffer, zip.byteOffset);
  let at = view.getUint32(zip.length - 22 + 16, true);
  for (let i = 0; i < n; i++) {
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return at;
}

function patch(zip: Uint8Array, at: number, value: number, bytes: 2 | 4): Uint8Array {
  const copy = zip.slice();
  const view = new DataView(copy.buffer);
  if (bytes === 2) view.setUint16(at, value, true);
  else view.setUint32(at, value, true);
  return copy;
}

describe("crc32", () => {
  it("is the IEEE CRC-32", () => {
    expect(crc32(encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("readZip / writeZip", () => {
  it("round-trips entries, stored and deflated, and their data", async () => {
    const entries = readZip(await sample());
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ["a.xml", 8, 600],
      ["media/b.bin", 0, 4],
      ["empty.txt", 8, 0],
    ]);
    expect(new TextDecoder().decode(await inflateEntry(entries[0] as ZipEntry))).toBe(
      "<a>".repeat(200),
    );
    expect(await inflateEntry(entries[1] as ZipEntry)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect((await inflateEntry(entries[2] as ZipEntry)).length).toBe(0);
  });

  it("writes entries it read back as the same bytes", async () => {
    const zip = await sample();
    expect(writeZip(readZip(zip))).toEqual(zip);
  });

  it("keeps a read entry's headers when other entries change", async () => {
    const zip = await sample();
    const [first, ...rest] = readZip(zip) as [ZipEntry, ...ZipEntry[]];
    const out = writeZip([await deflateEntry("a.xml", encode("changed"), first), ...rest]);
    const again = readZip(out);
    expect(new TextDecoder().decode(await inflateEntry(again[0] as ZipEntry))).toBe("changed");
    // The other entries moved but are byte for byte what they were.
    expect(again[1]?.stored?.local).toEqual(rest[0]?.stored?.local);
    expect(again[1]?.raw).toEqual(rest[0]?.raw);
    expect(await inflateEntry(again[1] as ZipEntry)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("reads entries with a data descriptor, with and without its signature", async () => {
    for (const signature of [true, false]) {
      const data = encode("described");
      const entry = await deflateEntry("d.txt", data);
      const name = entry.nameBytes;
      const local = new Uint8Array(30 + name.length);
      const l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true);
      l.setUint16(6, 0x08, true);
      l.setUint16(8, 8, true);
      l.setUint16(26, name.length, true);
      local.set(name, 30);
      const descriptor = new Uint8Array(signature ? 16 : 12);
      const d = new DataView(descriptor.buffer);
      const base = signature ? 4 : 0;
      if (signature) d.setUint32(0, 0x08074b50, true);
      d.setUint32(base, entry.crc32, true);
      d.setUint32(base + 4, entry.raw.length, true);
      d.setUint32(base + 8, entry.size, true);
      // The central record has the real sizes, the local header zeros: as Java and others write.
      const centralRecord = writeZip([entry]).slice(30 + name.length + entry.raw.length, -22);
      new DataView(centralRecord.buffer).setUint16(8, 0x08, true);
      const dirOffset = local.length + entry.raw.length + descriptor.length;
      const end = new Uint8Array(22);
      const e = new DataView(end.buffer);
      e.setUint32(0, 0x06054b50, true);
      e.setUint16(8, 1, true);
      e.setUint16(10, 1, true);
      e.setUint32(12, centralRecord.length, true);
      e.setUint32(16, dirOffset, true);
      const zip = new Uint8Array([...local, ...entry.raw, ...descriptor, ...centralRecord, ...end]);

      const [read] = readZip(zip) as [ZipEntry];
      expect(new TextDecoder().decode(await inflateEntry(read))).toBe("described");
      expect(read.stored?.descriptor.length).toBe(signature ? 16 : 12);
      expect(writeZip([read])).toEqual(zip);
    }
  });

  it("reads past a trailing comment", async () => {
    const zip = await sample();
    const withComment = new Uint8Array([...patch(zip, zip.length - 2, 5, 2), ...encode("hello")]);
    expect(readZip(withComment)).toHaveLength(3);
  });
});

describe("errors", () => {
  it("rejects what is not a zip", async () => {
    expect(() => readZip(encode("plain text, not a zip at all"))).toThrow(/Not a zip archive/);
    expect(() => readZip(new Uint8Array(3))).toThrow(/Not a zip archive/);
    const cfb = new Uint8Array(512);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => readZip(cfb)).toThrow(/encrypted document or a legacy \.doc/);
    const zip = await sample();
    expect(() => readZip(zip.slice(0, zip.length - 5))).toThrow(ZipError);
  });

  it("rejects damaged structure", async () => {
    const zip = await sample();
    const view = new DataView(zip.buffer);
    const dir = view.getUint32(zip.length - 22 + 16, true);
    expect(() => readZip(patch(zip, central(zip, 1), 0, 4))).toThrow(
      /bad central directory record/,
    );
    // An end record whose directory is not right before it is not taken.
    expect(() => readZip(patch(zip, zip.length - 22 + 16, dir + 1, 4))).toThrow(
      /Not a zip archive/,
    );
    // Fewer records than the directory's size.
    expect(() =>
      readZip(patch(patch(zip, zip.length - 22 + 8, 2, 2), zip.length - 22 + 10, 2, 2)),
    ).toThrow(/central directory size mismatch/);
    expect(() => readZip(patch(zip, central(zip, 1) + 42, 1, 4))).toThrow(
      /no local header for media\/b\.bin/,
    );
    expect(() => readZip(patch(zip, central(zip, 0) + 20, dir, 4))).toThrow(
      /data out of range for a\.xml/,
    );
    expect(() => readZip(patch(zip, zip.length - 22 + 4, 1, 2))).toThrow(/Multi-disk/);
  });

  it("rejects ZIP64, encryption, other methods and duplicate names", async () => {
    const zip = await sample();
    expect(() => readZip(patch(zip, zip.length - 22 + 10, 0xffff, 2))).toThrow(/ZIP64/);
    expect(() => readZip(patch(zip, central(zip, 0) + 24, 0xffffffff, 4))).toThrow(/ZIP64/);
    expect(() => readZip(patch(zip, central(zip, 0) + 8, 1, 2))).toThrow(/Encrypted entry: a\.xml/);
    expect(() => readZip(patch(zip, central(zip, 0) + 10, 12, 2))).toThrow(
      /Unsupported compression method 12/,
    );
    const duplicate = writeZip([
      storedEntry("A.xml", encode("1")),
      storedEntry("a.XML", encode("2")),
    ]);
    expect(() => readZip(duplicate)).toThrow(/Duplicate entry: a\.XML/);
  });

  it("enforces the limits", async () => {
    const zip = await sample();
    expect(() => readZip(zip, { maxEntries: 2 })).toThrow(/Too many entries: 3/);
    expect(() => readZip(zip, { maxSize: 603 })).toThrow(/Too large once uncompressed/);
    expect(readZip(zip, { maxSize: 604 })).toHaveLength(3);
  });

  it("stops inflating at the declared size (a zip bomb)", async () => {
    const big = await deflateEntry("bomb", new Uint8Array(1_000_000));
    const lying: ZipEntry = { ...big, size: 1000 };
    await expect(inflateEntry(lying)).rejects.toThrow(/wrong size for bomb/);
    await expect(inflateEntry({ ...big, size: 1_000_001 })).rejects.toThrow(/wrong size for bomb/);
  });

  it("detects corrupted data", async () => {
    const entry = await deflateEntry("x", encode("some text that compresses ".repeat(20)));
    await expect(inflateEntry({ ...entry, crc32: entry.crc32 ^ 1 })).rejects.toThrow(
      /CRC mismatch for x/,
    );
    const cut = entry.raw.subarray(0, entry.raw.length >> 1);
    await expect(inflateEntry({ ...entry, raw: cut })).rejects.toThrow(/cannot decompress x/);
    const invalid = entry.raw.slice();
    invalid[0] = 0xff; // block type 3: reserved, invalid
    await expect(inflateEntry({ ...entry, raw: invalid })).rejects.toThrow(/cannot decompress x/);
    const stored = storedEntry("s", encode("abc"));
    await expect(inflateEntry({ ...stored, size: 4 })).rejects.toThrow(/wrong size for s/);
  });

  it("refuses declared sizes deflate cannot produce, before any allocation", async () => {
    const zip = await sample();
    // a.xml: 600 bytes deflated to a few; declaring 400 MiB is a lie.
    expect(() => readZip(patch(zip, central(zip, 0) + 24, 400 * 1024 * 1024, 4))).toThrow(
      /impossible size for a\.xml/,
    );
    // A stored entry is exactly as large as its data.
    expect(() => readZip(patch(zip, central(zip, 1) + 24, 5, 4))).toThrow(
      /impossible size for media\/b\.bin/,
    );
  });

  it("requires each local header to match its directory record", async () => {
    const zip = await sample();
    const name = 30; // the first local header's name
    const mismatch = /local header does not match the directory for a\.xml/;
    expect(() => readZip(patch(zip, name, 0x62, 2))).toThrow(mismatch);
    expect(() => readZip(patch(zip, 8, 0, 2))).toThrow(mismatch);
    expect(() => readZip(patch(zip, 14, 1, 4))).toThrow(mismatch);
    expect(() => readZip(patch(zip, 22, 601, 4))).toThrow(mismatch);
  });

  it("refuses entries that overlap", async () => {
    // b.txt is a whole entry hidden inside a.bin's stored data: two names, the same bytes.
    const inner = writeZip([storedEntry("b.txt", encode("hidden"))]);
    const innerLocal = inner.subarray(0, 30 + 5 + 6);
    const innerCentral = inner.slice(30 + 5 + 6, -22);
    const outer = writeZip([storedEntry("a.bin", innerLocal)]);
    const outerLocalLength = 30 + 5;
    new DataView(innerCentral.buffer).setUint32(42, outerLocalLength, true);
    const outerCentral = outer.subarray(outerLocalLength + innerLocal.length, -22);
    const dirOffset = outerLocalLength + innerLocal.length;
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, 2, true);
    e.setUint16(10, 2, true);
    e.setUint32(12, outerCentral.length + innerCentral.length, true);
    e.setUint32(16, dirOffset, true);
    const zip = new Uint8Array([
      ...outer.subarray(0, dirOffset),
      ...outerCentral,
      ...innerCentral,
      ...end,
    ]);
    expect(() => readZip(zip)).toThrow(/b\.txt overlaps another entry/);
  });

  it("does not take an end record hidden in the archive comment", async () => {
    const zip = await sample();
    const fake = new Uint8Array(22);
    new DataView(fake.buffer).setUint32(0, 0x06054b50, true);
    const withFake = new Uint8Array([...patch(zip, zip.length - 2, 22, 2), ...fake]);
    expect(readZip(withFake)).toHaveLength(3);
  });

  it("checks a data descriptor against the directory", async () => {
    const zip = await sample();
    // Flag the first entry as described (central and local), with a descriptor that lies: the
    // bytes after its data are the next local header, not its CRC and sizes.
    const flagged = patch(patch(zip, 6, 0x08, 2), central(zip, 0) + 8, 0x08, 2);
    expect(() => readZip(flagged)).toThrow(/local header does not match the directory for a\.xml/);
  });

  it("keeps the replaced entry's name bytes and their encoding", async () => {
    // A CP437 name (no UTF-8 flag): 0x82 is "é" there, invalid alone in UTF-8.
    const old: ZipEntry = {
      ...storedEntry("x", encode("1")),
      nameBytes: new Uint8Array([0x82]),
      flags: 0,
    };
    const replaced = await deflateEntry(old.name, encode("2"), old);
    expect(replaced.nameBytes).toEqual(new Uint8Array([0x82]));
    expect(replaced.flags & 0x0800).toBe(0);
    const fresh = await deflateEntry("é", encode("2"));
    expect(fresh.nameBytes).toEqual(new Uint8Array([0xc3, 0xa9]));
    expect(fresh.flags & 0x0800).toBe(0x0800);
  });
});
