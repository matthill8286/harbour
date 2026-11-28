-- The licence a new workspace is being set up under, carried from the sign-up
-- form to the emailed link.
ALTER TABLE "SignupRequest" ADD COLUMN "licenceId" TEXT;
