export type SniffedImageType = "jpeg" | "png" | "apng" | "unsupported";

export function sniffImageType(bytes: Uint8Array): SniffedImageType;
