import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

type FsSyncMethod = (...args: unknown[]) => unknown;
type FsAsyncMethod = (...args: unknown[]) => Promise<unknown>;

const fsGet = (method: string): FsSyncMethod | undefined => {
  if (method === 'readFileSync') return fs.readFileSync as FsSyncMethod;
  if (method === 'existsSync') return fs.existsSync as FsSyncMethod;
  if (method === 'mkdirSync') return fs.mkdirSync as FsSyncMethod;
  if (method === 'writeFileSync') return fs.writeFileSync as FsSyncMethod;
  if (method === 'unlinkSync') return fs.unlinkSync as FsSyncMethod;
  if (method === 'statSync') return fs.statSync as FsSyncMethod;
  if (method === 'readdirSync') return fs.readdirSync as FsSyncMethod;
  if (method === 'realpathSync') return fs.realpathSync as FsSyncMethod;
  if (method === 'createReadStream') return fs.createReadStream as FsSyncMethod;
  if (method === 'createWriteStream') return fs.createWriteStream as FsSyncMethod;
  if (method === 'mkdtempSync') return fs.mkdtempSync as FsSyncMethod;
  if (method === 'rmdirSync') return fs.rmdirSync as FsSyncMethod;
  if (method === 'renameSync') return fs.renameSync as FsSyncMethod;
  if (method === 'lstatSync') return fs.lstatSync as FsSyncMethod;
  if (method === 'symlinkSync') return fs.symlinkSync as FsSyncMethod;
  return undefined;
};

const fsPromisesGet = (method: string): FsAsyncMethod | undefined => {
  if (method === 'readFile') return fsPromises.readFile as FsAsyncMethod;
  if (method === 'writeFile') return fsPromises.writeFile as FsAsyncMethod;
  if (method === 'mkdir') return fsPromises.mkdir as FsAsyncMethod;
  if (method === 'unlink') return fsPromises.unlink as FsAsyncMethod;
  if (method === 'stat') return fsPromises.stat as FsAsyncMethod;
  if (method === 'readdir') return fsPromises.readdir as FsAsyncMethod;
  return undefined;
};

export function safePath(filePath: string): string {
  return resolve(filePath);
}

export function resolveWithinRoot(
  rootPath: string,
  childPath: string,
  basePath: string = rootPath,
): string {
  const root = resolve(rootPath);
  const base = resolve(basePath);
  const candidate = resolve(isAbsolute(childPath) ? childPath : `${base}${sep}${childPath}`);
  const relativePath = relative(root, candidate);

  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Path outside allowed root: ${childPath}`);
  }

  return candidate;
}

export async function safeReadFile(
  filePath: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<string> {
  const fn = fsPromisesGet('readFile');
  return fn!(resolve(filePath), encoding) as Promise<string>;
}

/**
 * Lit un fichier en binaire (aucun encodage passé à `fs.promises.readFile`,
 * qui renvoie alors un Buffer). Nécessaire pour les charges audio, où un
 * décodage texte corromprait les octets.
 */
export async function safeReadFileBuffer(filePath: string): Promise<Buffer> {
  const fn = fsPromisesGet('readFile');
  return fn!(resolve(filePath)) as Promise<Buffer>;
}

export function safeReadFileSync(filePath: string, encoding: BufferEncoding = 'utf-8'): string {
  const fn = fsGet('readFileSync');
  return fn!(resolve(filePath), encoding) as string;
}

export function safeReadFileSyncBuffer(filePath: string): Buffer {
  const fn = fsGet('readFileSync');
  return fn!(resolve(filePath)) as Buffer;
}

export function safeRenameSync(oldPath: string, newPath: string): void {
  const fn = fsGet('renameSync');
  fn!(resolve(oldPath), resolve(newPath));
}

export function safeExistsSync(filePath: string): boolean {
  const fn = fsGet('existsSync');
  return fn!(resolve(filePath)) as boolean;
}

export function safeMkdirSync(
  filePath: string,
  options?: fs.MakeDirectoryOptions,
): string | undefined {
  const fn = fsGet('mkdirSync');
  return fn!(resolve(filePath), options) as string | undefined;
}

export async function safeMkdir(
  filePath: string,
  options?: fs.MakeDirectoryOptions,
): Promise<string | undefined> {
  const fn = fsPromisesGet('mkdir');
  return fn!(resolve(filePath), options) as Promise<string | undefined>;
}

export function safeWriteFileSync(
  filePath: string,
  data: string | Uint8Array,
  options?: fs.WriteFileOptions,
): void {
  const fn = fsGet('writeFileSync');
  fn!(resolve(filePath), data, options);
}

export async function safeWriteFile(
  filePath: string,
  data: string | Uint8Array,
  options?: fs.WriteFileOptions,
): Promise<void> {
  const fn = fsPromisesGet('writeFile');
  await fn!(resolve(filePath), data, options);
}

export async function safeAppendFile(
  filePath: string,
  data: string | Uint8Array,
  options?: fs.WriteFileOptions,
): Promise<void> {
  const fn = fsPromisesGet('appendFile');
  await fn!(resolve(filePath), data, options);
}

export function safeUnlinkSync(filePath: string): void {
  const fn = fsGet('unlinkSync');
  fn!(resolve(filePath));
}

export async function safeUnlink(filePath: string): Promise<void> {
  const fn = fsPromisesGet('unlink');
  await fn!(resolve(filePath));
}

export function safeStatSync(filePath: string): fs.Stats {
  const fn = fsGet('statSync');
  return fn!(resolve(filePath)) as fs.Stats;
}

export function safeRealPathSync(filePath: string): string {
  const fn = fsGet('realpathSync');
  return fn!(resolve(filePath)) as string;
}

export async function safeStat(filePath: string): Promise<fs.Stats> {
  const fn = fsPromisesGet('stat');
  return fn!(resolve(filePath)) as Promise<fs.Stats>;
}

export async function safeReaddir(
  filePath: string,
  options?: fs.ObjectEncodingOptions & { withFileTypes?: boolean },
): Promise<unknown> {
  const fn = fsPromisesGet('readdir');
  return fn!(resolve(filePath), options);
}

export function safeReaddirSync(filePath: string): string[] {
  const fn = fsGet('readdirSync');
  return fn!(resolve(filePath)) as string[];
}

export function safeCreateReadStream(
  filePath: string,
  options?: Parameters<typeof fs.createReadStream>[1],
): fs.ReadStream {
  const fn = fsGet('createReadStream');
  return fn!(resolve(filePath), options) as fs.ReadStream;
}

export function safeCreateWriteStream(
  filePath: string,
  options?: Parameters<typeof fs.createWriteStream>[1],
): fs.WriteStream {
  const fn = fsGet('createWriteStream');
  return fn!(resolve(filePath), options) as fs.WriteStream;
}

export function safeMkdtempSync(prefix: string): string {
  const fn = fsGet('mkdtempSync');
  return fn!(prefix) as string;
}

export function safeRmdirSync(filePath: string): void {
  const fn = fsGet('rmdirSync');
  fn!(resolve(filePath));
}

export function safeRemoveDirectorySync(filePath: string): void {
  fs.rmSync(resolve(filePath), { recursive: true, force: true });
}

export function safeLstatSync(filePath: string): fs.Stats {
  const fn = fsGet('lstatSync');
  return fn!(resolve(filePath)) as fs.Stats;
}

export function safeSymlinkSync(target: string, path: string): void {
  const fn = fsGet('symlinkSync');
  fn!(resolve(target), resolve(path));
}
