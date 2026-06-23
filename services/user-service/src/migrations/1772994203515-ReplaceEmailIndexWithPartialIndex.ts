import { MigrationInterface, QueryRunner } from "typeorm";

export class ReplaceEmailIndexWithPartialIndex1772994203515 implements MigrationInterface {
    name = 'ReplaceEmailIndexWithPartialIndex1772994203515'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "users_email_active_uniq" ON "users" ("email") WHERE "deleted_at" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const duplicates = await queryRunner.query(`
            SELECT "email"
            FROM "users"
            GROUP BY "email"
            HAVING COUNT(*) > 1
        `);

        if (duplicates.length > 0) {
            throw new Error(
                'Cannot restore global email uniqueness while duplicate emails exist',
            );
        }

        await queryRunner.query(`DROP INDEX "public"."users_email_active_uniq"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email")`);
    }

}
