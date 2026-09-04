# v3.7.3 routing policy

Generate plausible journey candidates first. Apply service availability only in the final stage. A missing future-transfer ETA does not invalidate the whole journey. Confirmed unavailable routes can be pruned when timetable/service-window data is available; unknown candidates are retained with lower priority rather than silently deleted.