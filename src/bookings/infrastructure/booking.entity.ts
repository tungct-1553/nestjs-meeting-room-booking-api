import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
@Entity('bookings')
@Check('bookings_valid_time', 'start_at < end_at')
@Check('bookings_valid_status', "status IN ('confirmed', 'cancelled')")
@Index('bookings_user_created_id', ['userId', 'createdAt', 'id'])
export class BookingEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'room_id', type: 'uuid' }) roomId!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'text' }) title!: string;
  @Column({ name: 'start_at', type: 'timestamptz' }) startAt!: Date;
  @Column({ name: 'end_at', type: 'timestamptz' }) endAt!: Date;
  @Column({ type: 'text', default: 'confirmed' }) status!: 'confirmed' | 'cancelled';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
