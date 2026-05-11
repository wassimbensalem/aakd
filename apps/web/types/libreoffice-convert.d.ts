// Ambient module declaration for libreoffice-convert.
// The package ships no bundled TypeScript types and there is no DefinitelyTyped
// entry for it. This declaration surfaces just the convert() function that the
// worker uses so tsc does not error on the import.
declare module "libreoffice-convert" {
  /**
   * Converts a document buffer to the target format.
   * @param buffer  Source file as a Buffer
   * @param format  Target extension including the dot, e.g. ".docx" or ".pdf"
   * @param filter  Optional LibreOffice export filter name (pass undefined to use the default)
   * @param callback  Node-style callback
   */
  export function convert(
    buffer: Buffer,
    format: string,
    filter: string | undefined,
    callback: (err: Error | null, result: Buffer) => void,
  ): void

  /** Promisify-compatible overload for use with util.promisify */
  export namespace convert {
    function __promisify__(
      buffer: Buffer,
      format: string,
      filter: string | undefined,
    ): Promise<Buffer>
  }
}
