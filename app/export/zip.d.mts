// Типы писателя ZIP для TypeScript-кода плагина (тест чтения архива в интерфейсе).
export function createZip(files: { name: string; data: Uint8Array | string; date?: Date }[]): Uint8Array
