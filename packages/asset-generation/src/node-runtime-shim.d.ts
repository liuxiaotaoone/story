// Node-only provider orchestration. The repository intentionally avoids a root @types/node dependency.
declare module 'node:fs/promises' {
  export const mkdir: (...args: any[]) => Promise<any>;
  export const mkdtemp: (...args: any[]) => Promise<string>;
  export const readFile: (...args: any[]) => Promise<Uint8Array>;
  export const rm: (...args: any[]) => Promise<any>;
  export const writeFile: (...args: any[]) => Promise<any>;
}
declare module 'node:os' { export const tmpdir: () => string; }
declare module 'node:path' {
  export const join: (...args: string[]) => string;
  export const resolve: (...args: string[]) => string;
}
