declare const process: {
  env: Record<string, string | undefined>;
  platform: string;
};

declare const Buffer: {
  from(input: string | Uint8Array, encoding?: string): any;
  concat(chunks: any[]): any;
};

declare module "node:child_process" {
  export function spawn(
    command: string,
    args: string[],
    options: {
      stdio: ["pipe", "pipe", "pipe"];
      windowsHide?: boolean;
    },
  ): any;
}

declare module "node:crypto" {
  export function createCipheriv(
    algorithm: string,
    key: any,
    iv: any,
  ): any;
  export function createDecipheriv(
    algorithm: string,
    key: any,
    iv: any,
  ): any;
  export function randomBytes(size: number): any;
}

declare module "node:http" {
  export type IncomingMessage = any;
  export type ServerResponse = any;
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): {
    listen(port: number, host: string, callback?: () => void): void;
  };
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
