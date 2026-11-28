# ADR-004: How long GPS positions are kept

**Status:** Accepted, 27 November 2026.

## Context

A trail shows where a vehicle and its driver have been, so it should not be kept longer than it is needed. One unit that reports every minute also adds about 525,000 rows a year.

The owner asked for the safest compliant approach. No law fixes a number of days. UK and EU data protection law require data to be kept no longer than is necessary, so 90 days is a cautious default chosen under that rule. It is not a legal finding.

## Decision

| Raw GPS points                  | Kept                             |
| ------------------------------- | -------------------------------- |
| On an open job                  | While the job is open            |
| On a completed or cancelled job | 90 days after the job was closed |
| On no job                       | 90 days after they were recorded |

- Copies marked `isDuplicate` follow the same rules.
- A job that is reopened before its points are deleted keeps them.
- Only GPS points are deleted. Jobs, status history, tracker records and other data are not changed.
- `GPS_RETENTION_DAYS` changes the period. It must be a whole number from 30 to 3650. With any other value the API does not start.
- An Admin can set the workspace's own period, from 30 to 3650 days, on the Workspace page. It replaces `GPS_RETENTION_DAYS` for that workspace's points only.
- The API runs the deletion a minute after it starts and then every six hours, in batches of 1,000. It logs counts only.

A closed job's date is its `completedAt`. If that is missing, its last change is used, which keeps the points longer. A unit left assigned to a closed job goes on adding points to it, and those are deleted at the next run once the job's period has passed.

## Backups

Deletion does not reach backups. The offsite backups keep 7 daily, 4 weekly and 3 monthly snapshots, so a deleted point can remain there for about three more months, or longer if backups stop running. The database dumps taken before each release are removed only by the pruning job in the hosting repository: after 30 days, always keeping the 10 newest. Until that job is installed they are kept, and the newest 10 can be older than 30 days.

A restored backup brings deleted points back. The next run deletes them again.

## For the privacy notice

> When a tracker is used for your vehicle's delivery, we record its position, speed and direction. We delete this location history 90 days after your job is completed or cancelled. Positions that are not linked to a job are deleted 90 days after they are recorded. Encrypted backups may keep a copy for a further period of about three months until they expire. We use a tracking provider, Flespi, to receive positions from the unit.

Before publishing it, check the backup period against the hosting set-up, add any other copies that exist, and change the number if `GPS_RETENTION_DAYS` is changed. The notice also needs the usual items that this decision does not cover, such as who is responsible for the data, the reason for processing it, and people's rights.
