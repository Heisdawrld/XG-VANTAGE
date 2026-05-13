# Task 2: Match Detail View Implementation

## Summary
Implemented a full-screen Match Detail overlay for the xG-Vantage football prediction app. This is a single-page app feature — all code resides in `src/app/page.tsx`.

## What Was Built

### MatchDetailOverlay Component
- Full-screen overlay that slides up from bottom using framer-motion spring animation
- Sticky header with back button, team names, scores, and match status (live/FT/upcoming)
- Tab navigation with animated indicator
- Fetches data from `/api/match?fixtureId=X` and `/api/standings?leagueId=X`

### 5 Tabs Implemented

1. **Prediction Tab** (default)
   - Match header with home/away teams and scores
   - Prediction result badge (H/D/A) with color coding
   - Circular confidence ring (SVG animated)
   - Probability bar (Home/Draw/Away with animated fills)
   - Expected goals (xG) with visual gauge displays
   - Most likely score prediction
   - Over/Under probabilities (1.5, 2.5, 3.5) with animated bars
   - BTTS probability with gradient bar
   - Value detection card (green glow, shows recommended bet + edge % + Kelly stake)
   - Model breakdown (Poisson-xG, ELO, Form, Style, Context) with horizontal bars
   - Context analysis (Home Advantage, Form, Rest, Motivation, Derby, Rotation)
   - AI Preview text (from metadata)
   - Market odds grid

2. **Stats Tab**
   - Home vs Away comparison layout
   - 19 stats: Possession, Shots, SOT, xG, Big Chances, Shots Inside Box, Corners, Attacks, Dangerous Attacks, Passes, Pass Accuracy, Tackles, Interceptions, Clearances, Dribbles, Offsides, Fouls, Yellow Cards, Red Cards
   - Split horizontal bars with color coding (indigo for home, amber for away)
   - Winning stat highlighted

3. **Lineup Tab**
   - Home/Away team selector toggle
   - Formation display + lineup status (confirmed/predicted/unavailable)
   - AI confidence score for predicted lineups
   - Starting XI grouped by position (GK, DEF, MID, FWD)
   - Player jersey numbers and ratings
   - Substitutes list
   - Unavailable players list

4. **Standings Tab**
   - League table with position coloring (top 4 green, 5-6 blue, bottom 3 red)
   - Columns: #, Team, P, W, D, L, GF, GA, GD, xGD, Pts
   - Both match teams highlighted with indigo background
   - Form display for highlighted teams (W/D/L colored badges)
   - Scrollable table with max height

5. **Live Tab** (only when match is inprogress)
   - Live score header with current minute
   - SVG football pitch shotmap visualization with goal markers
   - Momentum graph (time-series SVG chart with home/away gradients)
   - Match incidents timeline (goals, cards, substitutions, periods)
   - Live stats summary grid (6 key stats)

### Supporting Components
- `ConfidenceRing` — SVG circular progress indicator with animated stroke
- `XGGauge` — Filled circle gauge for xG values
- `ContextBar` — Progress bar for context analysis metrics
- `Shotmap` — SVG football pitch with goal markers
- `MomentumGraph` — SVG area chart with gradients
- `IncidentsTimeline` — Animated event list with icons
- `StatBlock` — Quick stat comparison for live tab
- `MatchDetailSkeleton` — Loading state skeleton

### Data Handling
- Comprehensive TypeScript types for all match data structures
- `safeParseJSON` helper for lineup player arrays
- Handles both database and API data sources
- Graceful fallbacks when data is unavailable

### Styling
- Glass-morphism cards consistent with existing app
- Framer-motion animations throughout (slide-up, fade, spring)
- Animated tab indicator using layoutId
- Premium dark theme (bg-slate-950, glass cards)
- Mobile-first responsive design
- Custom CSS additions: match-detail-scroll, value-glow, ring-fill animation

## Files Modified
- `src/app/page.tsx` — Added MatchDetailOverlay + all sub-components (kept existing Home/Picks/Acca/Profile tabs intact)
- `src/app/globals.css` — Added match-detail-scroll, ring-fill, value-glow styles

## Verification
- ESLint passes with no errors
- Dev server compiles successfully
- All existing functionality preserved (4 bottom nav tabs still work)
- PicksTab now supports `onSelectMatch` prop for navigating to match detail
