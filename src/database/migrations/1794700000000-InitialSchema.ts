import type { MigrationInterface, QueryRunner } from 'typeorm';
export class InitialSchema1794700000000 implements MigrationInterface {
  name = 'InitialSchema1794700000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
    await queryRunner.query(`CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), keycloak_sub text NOT NULL UNIQUE,
      email text, display_name text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE TABLE rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, capacity integer NOT NULL,
      description text, is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rooms_capacity_positive CHECK (capacity > 0)
    )`);
    await queryRunner.query(`CREATE TABLE bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, title text NOT NULL,
      start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'confirmed',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT bookings_valid_time CHECK (start_at < end_at),
      CONSTRAINT bookings_valid_status CHECK (status IN ('confirmed', 'cancelled')),
      CONSTRAINT bookings_no_overlap EXCLUDE USING gist
        (room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status = 'confirmed')
    )`);
    await queryRunner.query(
      'CREATE INDEX bookings_user_created_id ON bookings (user_id, created_at, id)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE bookings');
    await queryRunner.query('DROP TABLE rooms');
    await queryRunner.query('DROP TABLE users');
    // Extension may be shared by other applications; retain it.
  }
}
