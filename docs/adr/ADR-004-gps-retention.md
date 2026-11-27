# ADR-004: How long GPS positions are kept

**Status:** Proposed. Nothing deletes GPS data until a period is chosen.

## Context

Positions are kept forever. One unit that reports every minute adds about 525,000 rows a year. A trail also shows where a vehicle and its driver have been, so it should not be kept longer than it is needed.

## Proposal

| Positions                                                            | Keep for                                   |
| -------------------------------------------------------------------- | ------------------------------------------ |
| On a job that is open                                                | As long as the job is open                 |
| On a job that is completed or cancelled                              | 12 months after `completedAt`, then delete |
| On no job (staff entries, and rows whose job or tracker was removed) | 30 days after `receivedAt`, then delete    |
| Marked as duplicates (`isDuplicate`)                                 | The same period as the rows above          |

Twelve months covers delivery disputes and late customer questions. If a longer record is needed for tax or insurance, keep the job's first and last positions with the job and still delete the rest of the trail.

## To decide

1. Is 12 months right for finished jobs?
2. Should a workspace be able to choose a shorter period?
3. Do any customers or authorities require a longer record?

## When it is decided

Delete in small batches from a daily job, starting with a run that only counts the rows it would remove. Backups keep deleted positions until the backups themselves expire, so the backup period belongs in the same decision.
