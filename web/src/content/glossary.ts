/**
 * Plain-English definitions. These power Rookie Mode (every dotted-underlined
 * term on the site) and the searchable glossary on the Learn page.
 */

export interface GlossaryEntry {
  id: string;
  term: string;
  short: string;
  category: 'Weekend' | 'Race' | 'Flags' | 'Tyres & strategy' | '2026 rules' | 'Results' | 'This site';
}

export const GLOSSARY: GlossaryEntry[] = [
  // Weekend
  { id: 'grand-prix', term: 'Grand Prix', category: 'Weekend', short: 'The main Sunday race of a weekend, about 305 km. It pays the most points: 25 for a win down to 1 for tenth.' },
  { id: 'sprint', term: 'Sprint', category: 'Weekend', short: 'A short Saturday race of about 100 km, held at six weekends a season, with points for the top eight (8 down to 1).' },
  { id: 'qualifying', term: 'Qualifying', category: 'Weekend', short: 'The knockout session that sets the grid. With 22 cars in 2026, the slowest six drop out in Q1, six more in Q2, and the top ten fight for pole in Q3.' },
  { id: 'q3', term: 'Q3', category: 'Weekend', short: 'The final part of qualifying: a ten-car shootout for pole position.' },
  { id: 'sprint-qualifying', term: 'Sprint Qualifying', category: 'Weekend', short: 'A shorter knockout session (SQ1–SQ3) that sets the grid for the sprint.' },
  { id: 'pole', term: 'Pole position', category: 'Weekend', short: 'First place on the starting grid, earned by the fastest lap in the final part of qualifying.' },
  { id: 'grid', term: 'Grid', category: 'Weekend', short: 'The starting order. Usually the qualifying order, adjusted for any penalties.' },
  { id: 'grid-penalty', term: 'Grid penalty', category: 'Weekend', short: 'Places a driver must drop on the grid, often for using more engine parts than the rules allow.' },
  { id: 'parc-ferme', term: 'Parc fermé', category: 'Weekend', short: '"Closed park": from qualifying onwards teams may barely touch the car\'s set-up. Breaking it means starting from the pit lane.' },
  { id: 'pit-lane-start', term: 'Pit-lane start', category: 'Weekend', short: 'Starting from the pit exit after everyone else has gone, usually because the car was changed under parc fermé.' },
  { id: 'constructor', term: 'Constructor', category: 'Weekend', short: 'A team that builds its own car. Teams compete for the Constructors\' Championship with the points of both drivers.' },

  // Race
  { id: 'lights-out', term: 'Lights out', category: 'Race', short: 'The start: five red lights come on one by one, then all go out together, and the race begins.' },
  { id: 'formation-lap', term: 'Formation lap', category: 'Race', short: 'A slow lap before the start so drivers can warm their tyres and brakes and line up on the grid.' },
  { id: 'gap', term: 'Gap', category: 'Race', short: 'Time behind the race leader. "Interval" is the time to the car directly ahead.' },
  { id: 'lapped', term: 'Lapped', category: 'Race', short: 'Caught and passed by the leader, so a full lap behind. Lapped cars finish when the leader does, a lap short.' },
  { id: 'safety-car', term: 'Safety Car', category: 'Race', short: 'A road car that leads the field at reduced speed while an incident is cleared. No overtaking; the field bunches up, wiping out gaps.' },
  { id: 'vsc', term: 'Virtual Safety Car', category: 'Race', short: 'Everyone must slow to a set pace but there is no physical safety car, so gaps stay roughly as they were.' },
  { id: 'track-limits', term: 'Track limits', category: 'Race', short: 'Cars must stay within the white lines. Going beyond them deletes the lap time, and repeat offences bring penalties.' },
  { id: 'time-penalty', term: 'Time penalty', category: 'Race', short: 'Seconds added to a driver\'s time (or served at a pit stop) for breaking the rules — causing a collision, speeding in the pit lane, and so on.' },
  { id: 'pit-stop', term: 'Pit stop', category: 'Race', short: 'Coming into the pit lane for new tyres. The stop itself takes 2–3 seconds; driving through the speed-limited pit lane costs far more.' },
  { id: 'pit-loss', term: 'Pit loss', category: 'Race', short: 'Total time a stop costs compared with staying on track: the slow pit lane plus the stop. Usually 18–25 seconds, depending on the circuit.' },

  // Flags
  { id: 'green-flag', term: 'Green flag', category: 'Flags', short: 'Track clear — racing can resume.' },
  { id: 'yellow-flag', term: 'Yellow flag', category: 'Flags', short: 'Danger ahead: slow down, no overtaking. A double yellow means be prepared to stop.' },
  { id: 'red-flag', term: 'Red flag', category: 'Flags', short: 'Session stopped. Cars return slowly to the pit lane; the race may restart later.' },
  { id: 'blue-flag', term: 'Blue flag', category: 'Flags', short: 'Shown to a lapped car: a faster car is about to lap you, let it by.' },
  { id: 'chequered-flag', term: 'Chequered flag', category: 'Flags', short: 'The end of the session. The race is over when the leader crosses the line under it.' },
  { id: 'black-white-flag', term: 'Black-and-white flag', category: 'Flags', short: 'A warning for unsporting driving, typically repeated track-limits offences.' },
  { id: 'black-orange-flag', term: 'Black flag with orange disc', category: 'Flags', short: 'The car has a dangerous mechanical problem and must pit immediately.' },

  // Tyres & strategy
  { id: 'compound', term: 'Compound', category: 'Tyres & strategy', short: 'How soft the tyre rubber is. Three dry compounds come to each race: Soft (red), Medium (yellow) and Hard (white). Softer is faster but wears out sooner.' },
  { id: 'soft', term: 'Soft', category: 'Tyres & strategy', short: 'The fastest and least durable dry tyre of the weekend, marked red.' },
  { id: 'medium', term: 'Medium', category: 'Tyres & strategy', short: 'The middle dry tyre, marked yellow — a balance of pace and life.' },
  { id: 'hard', term: 'Hard', category: 'Tyres & strategy', short: 'The slowest and most durable dry tyre, marked white.' },
  { id: 'intermediate', term: 'Intermediate', category: 'Tyres & strategy', short: 'Green-marked tyre for a damp or lightly wet track.' },
  { id: 'wet', term: 'Wet', category: 'Tyres & strategy', short: 'Blue-marked tyre for heavy rain, built to clear standing water.' },
  { id: 'two-compound-rule', term: 'Two-compound rule', category: 'Tyres & strategy', short: 'In a dry race every driver must use at least two different dry compounds, so at least one pit stop is compulsory.' },
  { id: 'stint', term: 'Stint', category: 'Tyres & strategy', short: 'The run of laps a driver does on one set of tyres, between stops.' },
  { id: 'degradation', term: 'Degradation', category: 'Tyres & strategy', short: '"Deg": tyres lose grip as they wear, so lap times creep up through a stint. Measured here in milliseconds lost per lap.' },
  { id: 'undercut', term: 'Undercut', category: 'Tyres & strategy', short: 'Pitting before the car ahead. Your fresh tyres are faster for a lap or two, so when they stop you may come out in front. This site is named after it.' },
  { id: 'overcut', term: 'Overcut', category: 'Tyres & strategy', short: 'Staying out longer than the car ahead and gaining while their new tyres warm up, or while they are stuck in traffic.' },
  { id: 'pit-window', term: 'Pit window', category: 'Tyres & strategy', short: 'The range of laps in which stopping makes strategic sense.' },
  { id: 'one-stop', term: 'One-stop', category: 'Tyres & strategy', short: 'A strategy with a single pit stop — two stints. A two-stop has three stints.' },

  // 2026 rules
  { id: 'active-aero', term: 'Active aerodynamics', category: '2026 rules', short: 'From 2026 the front and rear wings adjust on the move: flaps open on straights for speed and close in corners for grip.' },
  { id: 'straight-mode', term: 'Straight Mode', category: '2026 rules', short: 'Wing flaps open to cut drag on straights, raising top speed. Available to every car at designated points.' },
  { id: 'corner-mode', term: 'Corner Mode', category: '2026 rules', short: 'Wing flaps closed — the normal high-downforce setting for cornering grip.' },
  { id: 'overtake-mode', term: 'Overtake', category: '2026 rules', short: 'Replaces DRS. Be within one second of the car ahead at the detection point and you get extra electrical energy and power for the next lap.' },
  { id: 'boost', term: 'Boost', category: '2026 rules', short: 'A button that deploys stored battery energy for extra power, to attack or defend, wherever the driver chooses on the lap.' },
  { id: 'recharge', term: 'Recharge', category: '2026 rules', short: 'Harvesting energy back into the battery, mostly under braking and when lifting off the throttle.' },
  { id: 'drs', term: 'DRS', category: '2026 rules', short: 'Drag Reduction System (2011–2025): a rear-wing flap a chasing driver could open within one second of the car ahead. Replaced in 2026 by Overtake.' },
  { id: 'power-unit', term: 'Power unit', category: '2026 rules', short: 'The hybrid engine. From 2026 roughly half its power is electrical and half from a combustion engine running on sustainable fuel.' },

  // Results
  { id: 'dnf', term: 'DNF', category: 'Results', short: 'Did Not Finish — retired from the race, usually through a crash or a mechanical failure.' },
  { id: 'dns', term: 'DNS', category: 'Results', short: 'Did Not Start.' },
  { id: 'dsq', term: 'DSQ', category: 'Results', short: 'Disqualified — removed from the results, for example for a car that breaks the technical rules.' },
  { id: 'classified', term: 'Classified', category: 'Results', short: 'A driver who completes at least 90% of the winner\'s distance is classified — given a finishing position — even if they retired.' },
  { id: 'fastest-lap', term: 'Fastest lap', category: 'Results', short: 'The quickest single lap of the race, shown in purple. It earned a bonus point from 2019 to 2024; it no longer does.' },
  { id: 'points', term: 'Points', category: 'Results', short: 'Grand Prix: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for the top ten. Sprint: 8 down to 1 for the top eight.' },
  { id: 'countback', term: 'Countback', category: 'Results', short: 'How ties on points are broken: most wins, then most second places, and so on.' },
  { id: 'purple', term: 'Purple', category: 'Results', short: 'Timing-screen colour for the fastest time by anyone. Green is a personal best; yellow is slower than your best.' },

  // This site
  { id: 'win-probability', term: 'Win probability', category: 'This site', short: 'How often a driver wins when the model plays the race out thousands of times. 30% means "wins about three times in ten", not "will finish third".' },
  { id: 'monte-carlo', term: 'Monte Carlo', category: 'This site', short: 'Simulating something many times with randomness and counting outcomes. Every probability on this site comes from thousands of simulated races.' },
  { id: 'plackett-luce', term: 'Plackett–Luce', category: 'This site', short: 'A model for rankings: the winner is drawn in proportion to strength, then second place from those left, and so on.' },
  { id: 'brier', term: 'Brier score', category: 'This site', short: 'Average squared gap between a forecast probability and what happened (1 or 0). Lower is better; you cannot game it by hedging.' },
  { id: 'log-loss', term: 'Log loss', category: 'This site', short: 'How surprised the forecast was by the real winner: −log of the probability it gave them. Lower is better; confident wrong calls are punished hard.' },
  { id: 'calibration', term: 'Calibration', category: 'This site', short: 'Whether probabilities mean what they say: things forecast at 20% should happen about one time in five.' },
  { id: 'walk-forward', term: 'Walk-forward test', category: 'This site', short: 'Re-forecasting each past race using only what was known before it, then scoring those forecasts. No peeking at the future.' },
  { id: 'baseline', term: 'Baseline', category: 'This site', short: 'A simple forecast to beat, such as "anyone can win" or "the pole sitter usually wins". A model that cannot beat its baselines is not adding anything.' },
  { id: 'half-life', term: 'Half-life', category: 'This site', short: 'How fast old races stop mattering: with a half-life of 6, a race six rounds ago counts half as much as the latest one.' },
  { id: 'driver-rating', term: 'Driver rating', category: 'This site', short: 'How a driver performs relative to an average driver in the same car, learned mainly from beating — or losing to — their teammate.' },
  { id: 'swing-chart', term: 'Swing chart', category: 'This site', short: 'Each driver\'s live win probability, lap by lap. Where a line jumps is where the race turned.' },
  { id: 'race-trace', term: 'Race trace', category: 'This site', short: 'Each driver\'s time behind the leader on every lap. Lines that drop away are losing time; jumps are pit stops.' },
];

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
