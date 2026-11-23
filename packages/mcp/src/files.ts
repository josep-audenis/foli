/**
 * What the server may read and write (ADR-0009): `.docx` files under a root, by their real
 * paths. A path comes from a model, which may be repeating what a document told it.
 */
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

/** @internal A file larger than this is not read. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** @internal */
export interface FileRules {
  /** The directory everything is under, as its real path. */
  root: string;
  /** Whether a save may write over a file the server did not write itself. */
  overwrite: boolean;
}

/** @internal A path allowed, or why not, in words for a model. */
export type Checked = { ok: true; file: string } | { ok: false; message: string };

const no = (message: string): Checked => ({ ok: false, message });

/** @internal `file` as the model is told it: relative to the root, with forward slashes. */
export const shown = (rules: FileRules, file: string) =>
  relative(rules.root, file).split("\\").join("/") || ".";

const inside = (root: string, file: string) => {
  const rel = relative(root, file);
  // `..` or under it: a name that only starts with two dots (`..draft.docx`) is inside.
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/**
 * @internal
 * Whether two paths are one file on disk, whatever they are called: on Windows and macOS a
 * name in other capitals is the same file, and so is a hard link's anywhere.
 */
export function same(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const [x, y] = [statSync(a, { bigint: true }), statSync(b, { bigint: true })];
    // No number (some network shares) tells nothing.
    return x.ino !== 0n && x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

/**
 * @internal
 * The rules for a root given on the command line. Throws when it is not a directory, or is a
 * file system's own root: a client that starts the server there has not chosen a folder.
 */
export function fileRules(root: string, overwrite: boolean): FileRules {
  const real = realpathSync(resolve(root));
  if (!statSync(real).isDirectory()) throw new Error(`Not a folder: ${root}`);
  if (parse(real).root === real)
    throw new Error(`${real} is a whole drive: start the server in a folder, or give --root`);
  return { root: real, overwrite };
}

/** A path as a tool is given it: a `.docx`'s name relative to the root, or why it is not. */
function named(path: unknown): string | Checked {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
  if (typeof path !== "string" || !path.trim() || /[\u0000-\u001F\u007F]/.test(path))
    return no("A path is the file's name, relative to the server's folder: contract.docx.");
  // Relative, and downwards only. A colon is a drive, or on Windows a stream of another file
  // (a.docx:b.docx); `..` would say whether a folder above the root has a given name.
  if (isAbsolute(path) || path.includes(":") || path.split(/[\\/]/).includes(".."))
    return no("A path is relative to the server's folder: contract.docx, or drafts/contract.docx.");
  if (extname(path).toLowerCase() !== ".docx") return no("Only .docx files are read and written.");
  return path;
}

const missing = (name: string) =>
  no(`There is no file ${JSON.stringify(name)} in the server's folder.`);

/**
 * @internal
 * The bytes of a file to read: there, a file, a `.docx`, under the root once links are
 * followed, not over the limit. What lies outside the root is answered as what is not there.
 */
export function read(
  rules: FileRules,
  path: unknown,
): { ok: true; file: string; bytes: Uint8Array } | { ok: false; message: string } {
  const name = named(path);
  if (typeof name !== "string") return name as { ok: false; message: string };
  let file: string;
  try {
    file = realpathSync(resolve(rules.root, name));
  } catch {
    return missing(name) as { ok: false; message: string };
  }
  if (!inside(rules.root, file) || extname(file).toLowerCase() !== ".docx")
    return missing(name) as { ok: false; message: string };
  const large = {
    ok: false as const,
    message: `${JSON.stringify(name)} is over ${MAX_FILE_BYTES / 1024 / 1024} MB: too large.`,
  };
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return { ok: false, message: `${JSON.stringify(name)} is not a file.` };
    if (stat.size > MAX_FILE_BYTES) return large;
    const bytes = readFileSync(file);
    // It may have grown since it was measured.
    return bytes.length > MAX_FILE_BYTES ? large : { ok: true, file, bytes: new Uint8Array(bytes) };
  } catch {
    return { ok: false, message: `${JSON.stringify(name)} could not be read.` };
  }
}

/**
 * @internal
 * Where a file may be written: a `.docx` name in a folder that is there and under the root once
 * links are followed. Whether something is there already is `write`'s to judge.
 */
export function target(rules: FileRules, path: unknown): Checked {
  const name = named(path);
  if (typeof name !== "string") return name;
  const wanted = resolve(rules.root, name);
  let directory: string;
  try {
    directory = realpathSync(dirname(wanted));
  } catch {
    return no(`The folder of ${JSON.stringify(name)} is not there in the server's folder.`);
  }
  if (directory !== rules.root && !inside(rules.root, directory))
    return no(`The folder of ${JSON.stringify(name)} is not there in the server's folder.`);
  return { ok: true, file: join(directory, basename(wanted)) };
}

/** @internal What stands at `file`, not following a link: nothing, a plain file, or something else. */
export function standing(file: string): "nothing" | "file" | "other" {
  try {
    return lstatSync(file).isFile() ? "file" : "other";
  } catch {
    return "nothing";
  }
}

/**
 * @internal
 * Writes `bytes` at `file` (from `target`). Over a file only when `replace` says the server may;
 * never over or through anything that is not a plain file (a link, even one that points
 * nowhere). The bytes go to a new file beside it, made exclusively, and are renamed into place:
 * a server stopped while saving leaves the old file whole.
 */
export function write(file: string, bytes: Uint8Array, replace: boolean): Checked {
  const name = JSON.stringify(basename(file));
  const there = standing(file);
  if (there === "other") return no(`${name} is not a file that can be written.`);
  if (there === "file" && !replace)
    return no(
      `${name} exists, and the server was not started to write over files. Save under another name.`,
    );
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let made = false;
  try {
    const handle = openSync(temporary, "wx");
    made = true;
    try {
      writeSync(handle, bytes);
    } finally {
      closeSync(handle);
    }
    // Nothing was there: it must still not be, or it is someone else's.
    if (there === "nothing" && standing(file) !== "nothing") throw new Error("taken");
    renameSync(temporary, file);
  } catch (error) {
    // Only what was made here: a file that stood at that name is someone's.
    if (made) rmSync(temporary, { force: true });
    const code = (error as { code?: unknown }).code;
    // Windows refuses to replace a file another program has open (Word does).
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES")
      return no(
        `${name} could not be written: the system refused (${code}). It may be open in another program, such as Word (close it there, or save under another name), or the folder may not be writable.`,
      );
    return no(`${name} could not be written.`);
  }
  return { ok: true, file };
}

/** @internal What tells a file from another put in its place: its size and when it was written. */
export function stamp(file: string): string | null {
  try {
    const stat = lstatSync(file);
    return stat.isFile() ? `${stat.size}:${stat.mtimeMs}` : null;
  } catch {
    return null;
  }
}
