// Types of the ZIP writer for the plugin's TypeScript code (the archive reading test in the UI).
export function createZip(files: { name: string; data: Uint8Array | string; date?: Date }[]): Uint8Array
