import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'keycloak_sub', type: 'text', unique: true }) keycloakSub!: string;
  @Column({ type: 'text', nullable: true }) email!: string | null;
  @Column({ name: 'display_name', type: 'text', nullable: true }) displayName!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
