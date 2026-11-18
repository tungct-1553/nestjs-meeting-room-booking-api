export interface Room {
  id: string;
  name: string;
  capacity: number;
  description: string | null;
  isActive: boolean;
}

export interface RoomDetailsPatch {
  name?: string;
  capacity?: number;
  description?: string | null;
}
