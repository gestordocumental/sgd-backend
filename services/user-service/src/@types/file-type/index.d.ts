// Local type shim for file-type v22+ (ESM-only package used via dynamic import).
// Provides type information without requiring moduleResolution: node16/bundler.
declare module 'file-type' {
  export interface FileTypeResult {
    ext: string;
    mime: string;
  }
  export function fileTypeFromBuffer(
    input: Buffer | Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined>;
}
