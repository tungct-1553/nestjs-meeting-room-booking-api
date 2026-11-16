import type { MigrationInterface, QueryRunner } from 'typeorm';
export class UserProfileTokenIat1794800000000 implements MigrationInterface {
  name = 'UserProfileTokenIat1794800000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users ADD COLUMN profile_token_iat double precision');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users DROP COLUMN profile_token_iat');
  }
}
