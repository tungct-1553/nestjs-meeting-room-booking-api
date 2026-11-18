import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
@Entity('rooms')
@Index('rooms_name_key', { synchronize: false })
@Check('rooms_capacity_positive', 'capacity > 0')
export class RoomEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'text' }) name!: string;
  @Column({ type: 'integer' }) capacity!: number;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
