import { adminShellModel } from './model.js';

export function AdminShell() {
  return (
    <main>
      <header>
        <div>
          <span>RUNSPHERE / OPERATIONS</span>
          <h1>{adminShellModel.heading}</h1>
        </div>
        <div className="status">System healthy</div>
      </header>
      <section className="metrics">
        <article>
          <small>LAUNCH MARKET</small>
          <strong>{adminShellModel.market}</strong>
          <p>Android-first public release</p>
        </article>
        <article>
          <small>MONTHLY INFRASTRUCTURE BUDGET</small>
          <strong>₹{adminShellModel.monthlyInfraBudgetInr.toLocaleString('en-IN')}</strong>
          <p>m0 operating ceiling</p>
        </article>
        <article>
          <small>SEASON</small>
          <strong>Monsoon Paths</strong>
          <p>Fair, pace-neutral scoring</p>
        </article>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <small>QUEST CATALOGUE</small>
            <h2>Starter paths</h2>
          </div>
          <button type="button">Add quest</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Quest</th>
              <th>Distance</th>
              <th>Duration</th>
              <th>Reward</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {adminShellModel.quests.map((quest) => (
              <tr key={quest.id}>
                <td>{quest.title}</td>
                <td>{quest.distanceKm} km</td>
                <td>{quest.durationMinutes} min</td>
                <td>+{quest.rewardXp} XP</td>
                <td>
                  <span className="tag">{quest.accessibility}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <footer>Demo member: {adminShellModel.demoMemberName} · Static m0 operations shell</footer>
    </main>
  );
}
