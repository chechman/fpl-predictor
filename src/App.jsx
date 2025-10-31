import { useState } from 'react'

function App() {
  const [teamId, setTeamId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [analysis, setAnalysis] = useState(null)

  const analyzeTeam = async () => {
    if (!teamId || teamId.trim() === '') {
      setError('Please enter your FPL Team ID')
      return
    }

    setLoading(true)
    setError(null)
    setAnalysis(null)

    try {
      // Call Netlify function
      const response = await fetch(`/.netlify/functions/analyze-team?teamId=${teamId}`)
      
      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`)
      }

      const data = await response.json()
      setAnalysis(data)
    } catch (err) {
      setError(err.message || 'Failed to analyze team. Please check your Team ID and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      analyzeTeam()
    }
  }

  return (
    <div className="container">
      <header className="header">
        <h1>⚽ FPL Predictor</h1>
        <p>AI-Powered Transfer Recommendations Based on Fixtures & Form</p>
      </header>

      <div className="input-section">
        <div className="input-group">
          <div className="input-wrapper">
            <label htmlFor="teamId">Your FPL Team ID</label>
            <input
              id="teamId"
              type="text"
              placeholder="e.g., 123456"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <small>
              Find your Team ID: Go to FPL → Points → Copy the number from your URL
              (fantasy.premierleague.com/entry/<strong>YOUR_ID</strong>/event/)
            </small>
          </div>
          <button 
            className="btn" 
            onClick={analyzeTeam}
            disabled={loading}
          >
            {loading ? 'Analyzing...' : 'Analyze Team'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Analyzing your team and scanning 600+ players...</p>
        </div>
      )}

      {analysis && <Results data={analysis} />}

      <footer className="footer">
        <p>
          Built with React + Netlify | Data from{' '}
          <a href="https://fantasy.premierleague.com" target="_blank" rel="noopener noreferrer">
            Official FPL API
          </a>
        </p>
        <p style={{ marginTop: '10px', fontSize: '0.875rem' }}>
          <strong>Disclaimer:</strong> This tool provides recommendations based on statistical analysis. 
          Always do your own research. Past performance doesn't guarantee future results.
        </p>
      </footer>
    </div>
  )
}

function Results({ data }) {
  return (
    <div className="results">
      {/* Team Overview */}
      <div className="card">
        <h2>📊 Your Team Overview</h2>
        <div className="team-info">
          <div className="stat">
            <div className="stat-label">Manager</div>
            <div className="stat-value">{data.teamName}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Overall Rank</div>
            <div className="stat-value">{data.overallRank?.toLocaleString() || 'N/A'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Team Value</div>
            <div className="stat-value">£{data.teamValue}m</div>
          </div>
          <div className="stat">
            <div className="stat-label">In The Bank</div>
            <div className="stat-value">£{data.bank}m</div>
          </div>
        </div>
      </div>

      {/* Current Squad */}
      <div className="card">
        <h2>👥 Your Current Squad (Next 5 GW Fixtures)</h2>
        <div className="player-grid">
          <div className="player-row header">
            <div>Player</div>
            <div>Form</div>
            <div>Price</div>
            <div>Fixtures</div>
            <div>Rating</div>
          </div>
          {data.squad.map((player, idx) => (
            <div key={idx} className="player-row">
              <div className="player-name">
                {player.name} <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>({player.team})</span>
              </div>
              <div>{player.form}</div>
              <div>£{player.price}m</div>
              <div style={{ fontSize: '0.875rem' }}>{player.fixtures}</div>
              <div>
                <span className={`badge badge-${player.ratingClass}`}>
                  {player.rating}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transfer Recommendations */}
      <div className="card">
        <h2>🔄 Recommended Transfers</h2>
        {data.transfers.map((transfer, idx) => (
          <div key={idx} className="recommendation">
            <h3>
              {idx === 0 ? '🔥 Priority' : '💡 Consider'}: {transfer.playerOut.name} → {transfer.playerIn.name}
            </h3>
            <p><strong>Why transfer out:</strong> {transfer.reasoning.out}</p>
            <p><strong>Why transfer in:</strong> {transfer.reasoning.in}</p>
            <p style={{ marginTop: '10px', fontSize: '0.875rem', color: '#667eea' }}>
              <strong>Projected Impact:</strong> +{transfer.projectedPoints} pts over next 5 GW | 
              Cost: {transfer.cost > 0 ? `£${transfer.cost}m` : 'Free'}
            </p>
          </div>
        ))}
        {data.transfers.length === 0 && (
          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
            Your team looks solid! No urgent transfers recommended right now.
          </p>
        )}
      </div>

      {/* Captain Picks */}
      <div className="card">
        <h2>🎯 Captain Recommendations (Next GW)</h2>
        {data.captains.map((captain, idx) => (
          <div key={idx} className={`captain-pick ${idx === 0 ? 'top' : ''}`}>
            <div className="captain-info">
              <h3>
                {idx === 0 && '👑 '}{captain.name}
              </h3>
              <p>{captain.reasoning}</p>
            </div>
            <div className="confidence">{captain.confidence}%</div>
          </div>
        ))}
      </div>

      {/* Key Insights */}
      <div className="card">
        <h2>💡 Key Insights</h2>
        {data.insights.map((insight, idx) => (
          <div key={idx} className="recommendation">
            <h3>{insight.icon} {insight.title}</h3>
            <p>{insight.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App