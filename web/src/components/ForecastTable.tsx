/** The model's call for one race: win / podium / points probabilities per driver. */

import type { DriverForecast } from '../model/forecast';
import type { Season } from '../data/types';
import { useTeams } from '../app/teams';
import { pct } from '../lib/format';
import { DriverTag, ProbBar, useExpand } from './ui';
import { Term } from './Term';

interface Props {
  season: Season;
  forecast: DriverForecast[];
  showPole: boolean;
  limit?: number;
  actual?: Map<string, number | null>;
}

export function ForecastTable({ season, forecast, showPole, limit = 10, actual }: Props) {
  const { colour } = useTeams();
  const [open, toggle] = useExpand(false);
  const rows = open ? forecast : forecast.slice(0, limit);
  const maxWin = Math.max(0.05, ...forecast.map((f) => f.pWin));
  return (
    <div>
      <div className="table-wrap">
        <table className="data-table forecast-table">
          <caption className="sr-only">Forecast probabilities for each driver</caption>
          <thead>
            <tr>
              <th scope="col" className="hide-sm">
                #
              </th>
              <th scope="col">Driver</th>
              <th scope="col" style={{ minWidth: 110 }}>
                <Term id="win-probability">Win</Term>
              </th>
              <th scope="col" className="r">Podium</th>
              <th scope="col" className="r hide-sm">
                <Term id="points">Points</Term>
              </th>
              {showPole ? (
                <th scope="col" className="r hide-sm">
                  <Term id="pole">Pole</Term>
                </th>
              ) : null}
              <th scope="col" className="r hide-sm">
                <Term id="dnf">DNF</Term>
              </th>
              {actual ? <th scope="col" className="r">Result</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((f, i) => {
              const res = actual?.get(f.driverId);
              return (
                <tr key={f.driverId}>
                  <td className="faint num hide-sm">{i + 1}</td>
                  <td>
                    <DriverTag driver={season.drivers[f.driverId]} driverId={f.driverId} teamId={f.teamId} showTeam />
                  </td>
                  <td>
                    <ProbBar p={f.pWin} max={maxWin} colour={colour(f.teamId)} label={`${season.drivers[f.driverId]?.familyName ?? f.driverId} wins`} />
                  </td>
                  <td className="r num">{pct(f.pPodium)}</td>
                  <td className="r num hide-sm">{pct(f.pPoints)}</td>
                  {showPole ? <td className="r num hide-sm">{pct(f.pPole ?? 0)}</td> : null}
                  <td className="r num faint hide-sm">{pct(f.pDnf)}</td>
                  {actual ? <td className="r num">{res === undefined ? '–' : res === null ? 'DNF' : `P${res}`}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {forecast.length > limit ? (
        <div style={{ padding: '8px 18px 0' }}>
          <button className="btn btn-ghost btn-sm" onClick={toggle} aria-expanded={open}>
            {open ? 'Show top ten' : `Show all ${forecast.length} drivers`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
