-- A group can now have several ways to match. Each group's single pattern becomes its first rule.
ALTER TABLE "ReportGroup" ADD COLUMN "rules" TEXT NOT NULL DEFAULT '[]';

UPDATE "ReportGroup"
SET "rules" = json_build_array(json_build_object('matchOn', "matchOn", 'matchType', "matchType", 'pattern', "pattern"))::text;

ALTER TABLE "ReportGroup" DROP COLUMN "matchOn", DROP COLUMN "matchType", DROP COLUMN "pattern";
