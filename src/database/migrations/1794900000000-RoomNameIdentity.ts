import type { MigrationInterface, QueryRunner } from 'typeorm';

// Freeze the ECMAScript trim set here: changing application helpers must not change this migration.
const trimCharactersSql = String.raw`U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'`;
const normalizedNameSql = `normalize(btrim(name, ${trimCharactersSql}), NFC)`;
const identitySql = `lower(${normalizedNameSql} COLLATE pg_catalog."pg_c_utf8")`;

export class RoomNameIdentity1794900000000 implements MigrationInterface {
  name = 'RoomNameIdentity1794900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.requireSupportedTransaction(queryRunner);
    // Hold the strongest required table lock before reading legacy rows or changing identity rules.
    await queryRunner.query('LOCK TABLE rooms IN ACCESS EXCLUSIVE MODE');
    const [invalid]: Array<{ exists: boolean }> = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM rooms WHERE char_length(${normalizedNameSql}) NOT BETWEEN 1 AND 200)`,
    );
    if (invalid.exists) {
      throw new Error(
        'Room name identity migration blocked: legacy names must contain 1..200 characters after trim and NFC normalization. Resolve invalid names explicitly before retrying.',
      );
    }
    const [duplicates]: Array<{ exists: boolean }> = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM rooms GROUP BY ${identitySql} HAVING count(*) > 1)`,
    );
    if (duplicates.exists) {
      throw new Error(
        'Room name identity migration blocked: legacy names collide after trim, NFC and case normalization. Resolve duplicate names explicitly before retrying.',
      );
    }

    // Raw SQL intentionally leaves timestamps and every non-name field unchanged.
    await queryRunner.query(
      `UPDATE rooms SET name = ${normalizedNameSql} WHERE name IS DISTINCT FROM ${normalizedNameSql}`,
    );
    await queryRunner.query('ALTER TABLE rooms DROP CONSTRAINT rooms_name_key');
    await queryRunner.query(`CREATE UNIQUE INDEX rooms_name_key ON rooms ((${identitySql}))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.requireSupportedTransaction(queryRunner);
    await queryRunner.query('LOCK TABLE rooms IN ACCESS EXCLUSIVE MODE');
    await queryRunner.query('DROP INDEX rooms_name_key');
    await queryRunner.query('ALTER TABLE rooms ADD CONSTRAINT rooms_name_key UNIQUE (name)');
    // Trim/NFC backfill is irreversible: the original whitespace and Unicode spelling bytes are not recoverable.
  }

  private async requireSupportedTransaction(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      throw new Error(
        'Room name identity migration requires an active transaction; use migration transaction mode all or each.',
      );
    }
    const [server]: Array<{ version: number; encoding: string }> = await queryRunner.query(
      `SELECT current_setting('server_version_num')::integer AS version, current_setting('server_encoding') AS encoding`,
    );
    if (server.version < 170000 || server.encoding !== 'UTF8') {
      throw new Error(
        'Room name identity migration requires PostgreSQL 17 or newer with UTF8 server encoding.',
      );
    }
  }
}
