-- Safeguards for trackers that clients bring themselves: how each unit is
-- powered and how often it reports, the lawful-use statement confirmed when it
-- was registered, confirmation that it was taken out of the vehicle, where each
-- position came from, and each workspace's GPS retention and gateway secret.
-- Every column is new, with a default or nullable, so the previous api keeps
-- working.

-- CreateEnum
CREATE TYPE "TrackerPowerSource" AS ENUM ('BATTERY', 'HARD_WIRED', 'OBD');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('GATEWAY', 'MANUAL');

-- AlterTable
ALTER TABLE "LocationEvent" ADD COLUMN     "source" "LocationSource" NOT NULL DEFAULT 'GATEWAY';

-- AlterTable
ALTER TABLE "OrganisationSettings" ADD COLUMN     "gpsRetentionDays" INTEGER,
ADD COLUMN     "gpsWebhookSecretHash" TEXT,
ADD COLUMN     "gpsWebhookSecretSetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tracker" ADD COLUMN     "fittedAt" TIMESTAMP(3),
ADD COLUMN     "fittedBy" TEXT,
ADD COLUMN     "ownerPermissionHeld" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "powerSource" "TrackerPowerSource" NOT NULL DEFAULT 'BATTERY',
ADD COLUMN     "reportIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "statementConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "statementConfirmedById" TEXT,
ADD COLUMN     "statementVersion" TEXT,
ADD COLUMN     "supplyVoltage" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "TrackerAssignment" ADD COLUMN     "lowBatteryAlertedAt" TIMESTAMP(3),
ADD COLUMN     "removalConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "removalConfirmedById" TEXT,
ADD COLUMN     "removalFitter" TEXT,
ADD COLUMN     "removalRequired" BOOLEAN NOT NULL DEFAULT false;
