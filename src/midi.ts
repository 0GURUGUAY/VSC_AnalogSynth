export const MAX_MIDI_BYTES = 10 * 1024 * 1024;

export function validateMidiBytes(bytes: Uint8Array): void {
  if (bytes.length > MAX_MIDI_BYTES) throw new Error("Le fichier MIDI dépasse la limite de 10 Mio.");
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 4)) !== "MThd") {
    throw new Error("Ce fichier n'est pas un fichier MIDI standard (.mid ou .midi).");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4);
  const format = view.getUint16(8);
  const tracks = view.getUint16(10);
  const division = view.getUint16(12);
  if (headerLength < 6 || headerLength + 8 > bytes.length || format > 2 || tracks === 0 || (format === 0 && tracks !== 1) || division === 0) {
    throw new Error("L'en-tête du fichier MIDI est invalide.");
  }
  let offset = 8 + headerLength;
  for (let track = 0; track < tracks; track += 1) {
    if (offset + 8 > bytes.length || String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== "MTrk") {
      throw new Error("Le fichier MIDI contient une piste manquante ou invalide.");
    }
    const length = view.getUint32(offset + 4);
    offset += 8 + length;
    if (offset > bytes.length) throw new Error("Le fichier MIDI est tronqué.");
  }
  if (offset !== bytes.length) throw new Error("Le fichier MIDI contient des données supplémentaires inattendues.");
}
