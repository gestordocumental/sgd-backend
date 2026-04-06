import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeRoleIdNullableInUserOrgRoles1775186318602 implements MigrationInterface {
    name = 'MakeRoleIdNullableInUserOrgRoles1775186318602'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_org_roles" DROP CONSTRAINT "UQ_8b7faa9d36151ec52426d498f85"`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" DROP CONSTRAINT "FK_d8e5e7828e44142bc24f6b24301"`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" ALTER COLUMN "role_id" DROP NOT NULL`);
        // Remove duplicate (user_id, org_id) rows keeping the most recently created one
        // before adding the new unique constraint
        await queryRunner.query(`
            DELETE FROM "user_org_roles"
            WHERE id NOT IN (
                SELECT DISTINCT ON (user_id, org_id) id
                FROM "user_org_roles"
                ORDER BY user_id, org_id, created_at DESC
            )
        `);
        await queryRunner.query(`ALTER TABLE "user_org_roles" ADD CONSTRAINT "UQ_2bda8cf92a55087b2b14dd4202e" UNIQUE ("user_id", "org_id")`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" ADD CONSTRAINT "FK_d8e5e7828e44142bc24f6b24301" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_org_roles" DROP CONSTRAINT "FK_d8e5e7828e44142bc24f6b24301"`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" DROP CONSTRAINT "UQ_2bda8cf92a55087b2b14dd4202e"`);
        // DESTRUCTIVE: Remove rows with null role_id before restoring the NOT NULL constraint.
        // Users who had their role cleared (but remained org members) will lose that membership record.
        await queryRunner.query(`DELETE FROM "user_org_roles" WHERE "role_id" IS NULL`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" ALTER COLUMN "role_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" ADD CONSTRAINT "FK_d8e5e7828e44142bc24f6b24301" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "user_org_roles" ADD CONSTRAINT "UQ_8b7faa9d36151ec52426d498f85" UNIQUE ("user_id", "org_id", "role_id")`);
    }

}
