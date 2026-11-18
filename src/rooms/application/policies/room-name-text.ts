export function formatRoomNameText(value: string): string {
  return value.trim().normalize('NFC');
}
