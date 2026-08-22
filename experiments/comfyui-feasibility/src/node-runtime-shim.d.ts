declare module 'node:fs/promises' {
  export const mkdir: (...args: any[]) => Promise<any>;
  export const mkdtemp: (...args: any[]) => Promise<string>;
  export const readFile: (...args: any[]) => Promise<Uint8Array>;
  export const rm: (...args: any[]) => Promise<any>;
  export const writeFile: (...args: any[]) => Promise<any>;
}
declare module 'node:os' { export const tmpdir: () => string; }
declare module 'node:path' {
  export const dirname: (...args: string[]) => string;
  export const join: (...args: string[]) => string;
  export const resolve: (...args: string[]) => string;
}
declare module 'node:url' { export const fileURLToPath: (url: string | URL) => string; }
declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
  exit(code?: number): never;
};
