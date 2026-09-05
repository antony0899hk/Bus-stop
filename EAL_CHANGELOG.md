# v3.8.0 East Rail line-first routing

- Detect the nearest practical East Rail station from the journey origin.
- Scan only the relevant East Rail direction, capped at 8 stations with an optional short fallback extension.
- For each candidate station, reuse the bus/minibus direct engine for the last mile to the destination.
- Prefer local KMB/Citybus index results first; query GMB only when bus candidates are sparse.
- Stop expanding when rail travel is already clearly slower than the best candidate.
- Skip the older all-network generic MTR gateway scan whenever the East Rail engine can handle the trip.
- Keep the district/corridor engine as a parallel non-rail candidate source.
