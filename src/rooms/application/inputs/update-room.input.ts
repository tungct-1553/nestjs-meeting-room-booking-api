export interface UpdateRoomInput {
  roomId: string;
  name?: string;
  capacity?: number;
  description?: string | null;
}
