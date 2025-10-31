// Netlify Serverless Function - FPL Team Analyzer
const fetch = require('node-fetch')

// FPL API Endpoints
const FPL_API = {
  bootstrap: 'https://fantasy.premierleague.com/api/bootstrap-static/',
  team: (teamId) => `https://fantasy.premierleague.com/api/entry/${teamId}/`,
  picks: (teamId, gw) => `https://fantasy.premierleague.com/api/entry/${teamId}/event/${gw}/picks/`,
  fixtures: 'https://fantasy.premierleague.com/api/fixtures/'
}

// Fixture Difficulty Ratings (lower is easier)
const DIFFICULTY_RATINGS = {
  1: 'Very Easy', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Very Hard'
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const teamId = event.queryStringParameters?.teamId

    if (!teamId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Team ID is required' })
      }
    }

    console.log(`Analyzing team: ${teamId}`)

    // Fetch all required data in parallel
    const [bootstrapData, teamData, fixturesData] = await Promise.all([
      fetch(FPL_API.bootstrap).then(r => r.json()),
      fetch(FPL_API.team(teamId)).then(r => r.json()),
      fetch(FPL_API.fixtures).then(r => r.json())
    ])

    // Get current gameweek
    const currentGW = bootstrapData.events.find(e => e.is_current)?.id || 1
    
    // Fetch current picks
    const picksData = await fetch(FPL_API.picks(teamId, currentGW)).then(r => r.json())

    // Build player lookup
    const playersMap = new Map()
    bootstrapData.elements.forEach(player => {
      playersMap.set(player.id, {
        ...player,
        team: bootstrapData.teams.find(t => t.id === player.team)?.short_name || 'UNK'
      })
    })

    // Build teams lookup
    const teamsMap = new Map()
    bootstrapData.teams.forEach(team => {
      teamsMap.set(team.id, team)
    })

    // Get next 5 fixtures for each team
    const teamFixtures = getNextFixtures(fixturesData, currentGW, teamsMap)

    // Analyze current squad
    const squad = picksData.picks.map(pick => {
      const player = playersMap.get(pick.element)
      const fixtures = teamFixtures.get(player.team_code)?.slice(0, 5) || []
      const avgDifficulty = fixtures.reduce((sum, f) => sum + f.difficulty, 0) / fixtures.length || 3
      
      return {
        id: player.id,
        name: player.web_name,
        team: player.team,
        position: getPosition(player.element_type),
        price: player.now_cost / 10,
        form: parseFloat(player.form).toFixed(1),
        selectedBy: player.selected_by_percent,
        fixtures: fixtures.map(f => f.opponent).join(', '),
        avgDifficulty: avgDifficulty.toFixed(1),
        rating: getRating(parseFloat(player.form), avgDifficulty),
        ratingClass: getRatingClass(parseFloat(player.form), avgDifficulty),
        totalPoints: player.total_points,
        pointsPerGame: player.points_per_game,
        isCaptain: pick.is_captain,
        isViceCaptain: pick.is_vice_captain
      }
    })

    // Find transfer opportunities
    const transfers = findTransferOpportunities(squad, playersMap, teamFixtures, teamData.last_deadline_bank / 10)

    // Captain recommendations
    const captains = getCaptainRecommendations(squad, teamFixtures)

    // Generate insights
    const insights = generateInsights(squad, transfers, teamData)

    // Return analysis
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        teamName: `${teamData.player_first_name} ${teamData.player_last_name}`,
        teamValue: (teamData.last_deadline_value / 10).toFixed(1),
        bank: (teamData.last_deadline_bank / 10).toFixed(1),
        overallRank: teamData.summary_overall_rank,
        gameweekRank: teamData.summary_event_rank,
        totalPoints: teamData.summary_overall_points,
        currentGW,
        squad,
        transfers,
        captains,
        insights
      })
    }

  } catch (error) {
    console.error('Error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to analyze team',
        message: error.message 
      })
    }
  }
}

// Helper Functions

function getNextFixtures(allFixtures, currentGW, teamsMap) {
  const teamFixtures = new Map()
  
  // Filter upcoming fixtures (next 8 GWs)
  const upcomingFixtures = allFixtures.filter(f => 
    f.event >= currentGW && f.event <= currentGW + 8
  ).sort((a, b) => a.event - b.event)

  teamsMap.forEach((team, teamCode) => {
    const fixtures = upcomingFixtures
      .filter(f => f.team_h === team.id || f.team_a === team.id)
      .map(f => {
        const isHome = f.team_h === team.id
        const opponent = isHome 
          ? teamsMap.get(f.team_a)?.short_name 
          : teamsMap.get(f.team_h)?.short_name
        const difficulty = isHome ? f.team_h_difficulty : f.team_a_difficulty
        
        return {
          gameweek: f.event,
          opponent: `${isHome ? '' : '@'}${opponent}`,
          difficulty,
          isHome
        }
      })
      .slice(0, 8)
    
    teamFixtures.set(team.short_name, fixtures)
  })

  return teamFixtures
}

function getPosition(elementType) {
  const positions = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' }
  return positions[elementType] || 'UNK'
}

function getRating(form, avgDifficulty) {
  // Form-based rating adjusted by fixture difficulty
  const formScore = form * 2
  const fixtureBonus = (5 - avgDifficulty) * 2
  const totalScore = formScore + fixtureBonus
  
  if (totalScore >= 14) return 'Excellent'
  if (totalScore >= 10) return 'Good'
  if (totalScore >= 6) return 'Average'
  return 'Poor'
}

function getRatingClass(form, avgDifficulty) {
  const rating = getRating(form, avgDifficulty)
  return rating.toLowerCase()
}

function findTransferOpportunities(squad, playersMap, teamFixtures, bank) {
  const transfers = []
  
  // Find players to transfer out (poor form + hard fixtures)
  const transferOutCandidates = squad
    .filter(p => parseFloat(p.form) < 3 || parseFloat(p.avgDifficulty) > 3.5)
    .sort((a, b) => parseFloat(a.form) - parseFloat(b.form))
    .slice(0, 3)

  transferOutCandidates.forEach(playerOut => {
    // Find replacement in same position with better fixtures and form
    const alternatives = Array.from(playersMap.values())
      .filter(p => 
        getPosition(p.element_type) === playerOut.position &&
        p.now_cost / 10 <= playerOut.price + bank &&
        parseFloat(p.form) > parseFloat(playerOut.form) &&
        p.id !== playerOut.id &&
        !squad.find(s => s.id === p.id)
      )
      .map(p => {
        const fixtures = teamFixtures.get(p.team)?.slice(0, 5) || []
        const avgDiff = fixtures.reduce((sum, f) => sum + f.difficulty, 0) / fixtures.length || 3
        return { ...p, avgDifficulty: avgDiff, fixtures }
      })
      .sort((a, b) => {
        const scoreA = parseFloat(a.form) * 2 - a.avgDifficulty
        const scoreB = parseFloat(b.form) * 2 - b.avgDifficulty
        return scoreB - scoreA
      })
      .slice(0, 1)

    if (alternatives.length > 0) {
      const playerIn = alternatives[0]
      const cost = (playerIn.now_cost / 10) - playerOut.price
      const projectedPoints = (parseFloat(playerIn.form) - parseFloat(playerOut.form)) * 5

      transfers.push({
        playerOut: {
          name: playerOut.name,
          team: playerOut.team,
          form: playerOut.form,
          price: playerOut.price,
          fixtures: playerOut.fixtures
        },
        playerIn: {
          name: playerIn.web_name,
          team: playerIn.team,
          form: parseFloat(playerIn.form).toFixed(1),
          price: playerIn.now_cost / 10,
          fixtures: playerIn.fixtures.map(f => f.opponent).join(', ')
        },
        cost: cost.toFixed(1),
        projectedPoints: projectedPoints.toFixed(1),
        reasoning: {
          out: `Form ${playerOut.form}, Difficult fixtures (${playerOut.fixtures}), Rating: ${playerOut.rating}`,
          in: `Strong form ${parseFloat(playerIn.form).toFixed(1)}, Favorable fixtures (${playerIn.fixtures.map(f => f.opponent).join(', ')}), ${playerIn.selected_by_percent}% owned`
        }
      })
    }
  })

  return transfers.slice(0, 2) // Return top 2 recommendations
}

function getCaptainRecommendations(squad, teamFixtures) {
  // Score players based on form and next fixture difficulty
  const captainCandidates = squad
    .map(player => {
      const fixtures = teamFixtures.get(player.team)?.slice(0, 1) || []
      const nextFixture = fixtures[0]
      const formScore = parseFloat(player.form) * 10
      const fixtureScore = nextFixture ? (6 - nextFixture.difficulty) * 5 : 0
      const homeBonus = nextFixture?.isHome ? 5 : 0
      const totalScore = formScore + fixtureScore + homeBonus
      
      return {
        ...player,
        nextFixture: nextFixture?.opponent || 'N/A',
        captainScore: totalScore,
        confidence: Math.min(95, Math.round(totalScore * 1.2))
      }
    })
    .sort((a, b) => b.captainScore - a.captainScore)
    .slice(0, 3)

  return captainCandidates.map((p, idx) => ({
    name: `${p.name} (${p.team})`,
    confidence: p.confidence,
    reasoning: idx === 0 
      ? `Top form (${p.form}), favorable fixture vs ${p.nextFixture}, ${p.selectedBy}% owned`
      : `Good form (${p.form}), decent fixture vs ${p.nextFixture}`
  }))
}

function generateInsights(squad, transfers, teamData) {
  const insights = []
  
  // Fixture analysis
  const easyFixtures = squad.filter(p => parseFloat(p.avgDifficulty) < 2.5).length
  const hardFixtures = squad.filter(p => parseFloat(p.avgDifficulty) > 3.5).length
  
  if (easyFixtures >= 5) {
    insights.push({
      icon: '✅',
      title: 'Strong Fixture Run',
      message: `${easyFixtures} of your players have favorable fixtures in the next 5 gameweeks. Good time to hold your team.`
    })
  } else if (hardFixtures >= 5) {
    insights.push({
      icon: '⚠️',
      title: 'Difficult Fixtures Ahead',
      message: `${hardFixtures} players face tough fixtures. Consider using your free transfer strategically or save it for a double gameweek.`
    })
  }
  
  // Form analysis
  const poorForm = squad.filter(p => parseFloat(p.form) < 2).length
  if (poorForm >= 3) {
    insights.push({
      icon: '📉',
      title: 'Form Concerns',
      message: `${poorForm} players are struggling for form. Monitor team news and consider transfers if this continues.`
    })
  }
  
  // Value insight
  const teamValue = teamData.last_deadline_value / 10
  if (teamValue >= 103) {
    insights.push({
      icon: '💰',
      title: 'Strong Team Value',
      message: `Your team is valued at £${teamValue.toFixed(1)}m. You've built good value through smart transfers and price rises.`
    })
  }
  
  // Transfer recommendation
  if (transfers.length > 0) {
    insights.push({
      icon: '🔄',
      title: 'Transfer Opportunities',
      message: `We've identified ${transfers.length} potential upgrade(s) that could improve your team over the next 5 gameweeks.`
    })
  } else {
    insights.push({
      icon: '✨',
      title: 'Team Looking Solid',
      message: 'No urgent transfers needed. Consider banking your free transfer or monitoring for upcoming double gameweeks.'
    })
  }

  return insights
}