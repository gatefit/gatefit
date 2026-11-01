export interface RgbImage { width: number; height: number; rgb: Uint8Array }
export interface Box { x: number; y: number; w: number; h: number }
export function isMint(r: number, g: number, b: number): boolean;
export function isOrbitMint(r: number, g: number, b: number): boolean;
export function insideRoundedRect(x: number, y: number, w: number, h: number, radius: number): number;
export function mintInside(img: RgbImage, box: Box, scaleX: number, scaleY: number): number;
export function mintPastBorder(img: RgbImage, scaleX: number, scaleY: number, radiusCss: number, holes: Box[]): number;
