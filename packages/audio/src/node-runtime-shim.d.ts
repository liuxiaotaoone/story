// Node-only provider orchestration. The repository intentionally avoids a root @types/node dependency.
declare module 'node:child_process' { export const execFile: (...args: any[]) => any; }
declare module 'node:crypto' { export const createHash: (...args: any[]) => any; }
declare module 'node:fs/promises' {
  export const mkdir: (...args: any[]) => Promise<any>;
  export const readFile: (...args: any[]) => Promise<any>;
  export const writeFile: (...args: any[]) => Promise<any>;
}
declare module 'node:path' { export const resolve: (...args: string[]) => string; }
declare module 'node:util' { export const promisify: (value: (...args: any[]) => any) => (...args: any[]) => Promise<any>; }
declare const process: {env: Record<string, string | undefined>};
