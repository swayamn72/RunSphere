import { productConfig } from '@runsphere/config';
import { demoMember, demoQuests } from '@runsphere/domain';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main>
      <header>
        <div>
          <span>RUNSPHERE / OPERATIONS</span>
          <h1>Good morning, Mumbai.</h1>
        </div>
        <div className="status">System healthy</div>
      </header>
      <section className="metrics">
        <article>
          <small>LAUNCH MARKET</small>
          <strong>{productConfig.market}</strong>
          <p>Android-first public release</p>
        </article>
        <article>
          <small>MONTHLY INFRASTRUCTURE BUDGET</small>
          <strong>₹{productConfig.monthlyInfraBudgetInr.toLocaleString('en-IN')}</strong>
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
            {demoQuests.map((quest) => (
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
      <footer>Demo member: {demoMember.name} · Static m0 operations shell</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
