import type { JackDirection } from "./types.ts";

export function isJackDirection(value: unknown): value is JackDirection {
  return value === "input" || value === "output" || value === "bidirectional";
}

export function jackDirection(port: { label: string; direction: JackDirection }): JackDirection {
  return /\b(?:micro|mini)?usb\b/i.test(port.label) ? "bidirectional" : port.direction;
}
