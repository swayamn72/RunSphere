import { useState, type FormEvent } from 'react';
import { getStaffReviewQueue, signIn, type StaffReviewItem } from './api.js';

const readableStatus = (status: StaffReviewItem['status']) => status.replace('_', ' ');

export function AdminShell() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState<string>();
  const [items, setItems] = useState<StaffReviewItem[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const loadQueue = async (token = accessToken) => {
    if (!token) return;
    setLoading(true);
    setError(undefined);
    try {
      const queue = await getStaffReviewQueue(token);
      setItems(queue.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load review queue');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      const session = await signIn(email, password);
      setAccessToken(session.accessToken);
      await loadQueue(session.accessToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <header>
        <div>
          <span>RUNSPHERE / OPERATIONS</span>
          <h1>Activity review</h1>
          <p>Authenticated staff access. Raw GPS, account contact details, and territory controls are unavailable here.</p>
        </div>
        {accessToken ? <div className="status">Staff session active</div> : <div className="status neutral">Sign in required</div>}
      </header>
      {!accessToken ? (
        <section className="panel sign-in-panel">
          <div className="panel-heading">
            <div>
              <small>STAFF AUTHENTICATION</small>
              <h2>Sign in to review</h2>
            </div>
          </div>
          <form onSubmit={handleSignIn}>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <small>DATA REVIEW QUEUE</small>
              <h2>Activities requiring attention</h2>
            </div>
            <button type="button" onClick={() => void loadQueue()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh queue'}
            </button>
          </div>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <table>
            <thead>
              <tr>
                <th>Submission</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Validation notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><code>{item.id}</code></td>
                  <td><span className="tag">{readableStatus(item.status)}</span></td>
                  <td>{new Date(item.submittedAt).toLocaleString()}</td>
                  <td>{item.rejectionReason ?? (item.validationErrors.join(', ') || 'Awaiting validation')}</td>
                </tr>
              ))}
              {!loading && items.length === 0 ? <tr><td colSpan={4}>No activities currently require review.</td></tr> : null}
            </tbody>
          </table>
        </section>
      )}
      {error && !accessToken ? <p className="error" role="alert">{error}</p> : null}
      <footer>Every queue read is audited. Territory remains off.</footer>
    </main>
  );
}
