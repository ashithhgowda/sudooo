const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const session = require('express-session'); // NEW
const cookieParser = require('cookie-parser'); // NEW

const app = express();
const PORT = 3000;

// NEW: Session middleware (add right after app initialization)
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-for-dev', // Change in production!
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const CODES_PATH = path.join(DATA_DIR, 'codes.json');
const TEAMS_PATH = path.join(DATA_DIR, 'teams.json');

// Initialize data directory
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Initialize data files if they don't exist
if (!fs.existsSync(CODES_PATH)) {
    fs.writeFileSync(CODES_PATH, JSON.stringify([]));
}
if (!fs.existsSync(TEAMS_PATH)) {
    fs.writeFileSync(TEAMS_PATH, JSON.stringify({}));
}

// Enhanced team data structure
const DEFAULT_TEAM = {
    password: '',
    points: 0,
    currentClue: null,
    attempts: {},
    disqualified: false
};

// Middleware to load data
app.use((req, res, next) => {
    try {
        req.codes = JSON.parse(fs.readFileSync(CODES_PATH, 'utf-8'));
        req.teams = JSON.parse(fs.readFileSync(TEAMS_PATH, 'utf-8'));
        next();
    } catch (err) {
        console.error('Error loading data:', err);
        res.status(500).send('Error loading data. Please try again later.');
    }
});

// Enhanced save functions with error handling
function saveCodes(codes) {
    try {
        fs.writeFileSync(CODES_PATH, JSON.stringify(codes, null, 2));
        console.log('Codes saved successfully at', new Date().toISOString());
        return true;
    } catch (err) {
        console.error('Error saving codes:', err);
        return false;
    }
}

function saveTeams(teams) {
    try {
        fs.writeFileSync(TEAMS_PATH, JSON.stringify(teams, null, 2));
        console.log('Teams saved successfully at', new Date().toISOString());
        return true;
    } catch (err) {
        console.error('Error saving teams:', err);
        return false;
    }
}
function checkAuth(req, res, next) {
    if (req.session.team || req.path.includes('/login')) {
      return next();
    }
    res.redirect('/index.html?message=Session+expired.+Please+login+again.&messageType=error');
  }
  

// Login route
app.post('/login', (req, res) => {
    const { teamName, password } = req.body;
    
    if (req.teams[teamName] && req.teams[teamName].password === password) {
      console.log(`Successful login: ${teamName}`);
      
      // Store session data
      req.session.team = teamName;
      req.session.save(err => {
        if (err) {
          console.error('Session save error:', err);
          return res.redirect('/index.html?message=Login+failed&messageType=error');
        }
  
        if (teamName.toLowerCase() === 'admin') {
          return res.redirect('/admin.html');
        }
  
        if (req.teams[teamName].disqualified) {
          return res.redirect(`/dashboard.html?team=${encodeURIComponent(teamName)}&message=Your+team+has+been+disqualified.&messageType=error`);
        }
  
        return res.redirect(`/dashboard.html?team=${encodeURIComponent(teamName)}`);
      });
    } else {
      console.log(`Failed login: ${teamName}`);
      return res.redirect('/index.html?message=Invalid+credentials.+Please+try+again.&messageType=error');
    }
  });
  
  // NEW: Session check for protected routes
  app.get('/dashboard.html', checkAuth, (req, res) => {
    if (!req.session.team) {
      return res.redirect('/index.html');
    }
    res.sendFile(path.join(__dirname, 'public/dashboard.html'));
  });
  
  app.get('/admin.html', checkAuth, (req, res) => {
    if (req.session.team?.toLowerCase() !== 'admin') {
      return res.redirect('/index.html');
    }
    res.sendFile(path.join(__dirname, 'public/admin.html'));
  });
// Add this near your other routes
app.post('/create-admin', (req, res) => {
    const { password } = req.body;
    
    if (!req.teams['admin']) {
        req.teams['admin'] = {
            password: password,
            points: 0,
            currentClue: null,
            attempts: {},
            totalIncorrectAttempts: 0,
            disqualified: false
        };
        
        if (saveTeams(req.teams)) {
            return res.send('Admin account created successfully');
        } else {
            return res.status(500).send('Failed to create admin account');
        }
    } else {
        return res.status(400).send('Admin account already exists');
    }
});

// Code verification route (submit code)
// ... (keep all previous code until the /submit-code route)

// Code verification route (submit code)
app.post('/submit-code', (req, res) => {
    const { team, clueCode } = req.body;

    // Validate team
    if (!team || !req.teams[team]) {
        return res.redirect(`/dashboard.html?team=${team}&message=Invalid team.&messageType=error`);
    }

    // Check if team is disqualified
    if (req.teams[team].disqualified) {
        return res.redirect(`/dashboard.html?team=${team}&message=Your team has been disqualified.&messageType=error`);
    }

    // Find the clue
    const codeIndex = req.codes.findIndex(c => c.code === clueCode);
    if (codeIndex === -1) {
        // Track failed attempts
        req.teams[team].attempts[clueCode] = (req.teams[team].attempts[clueCode] || 0) + 1;
        req.teams[team].totalIncorrectAttempts += 1;
        
        const attemptsLeft = 3 - req.teams[team].totalIncorrectAttempts;
        
        if (!saveTeams(req.teams)) {
            return res.redirect(`/dashboard.html?team=${team}&message=System error. Please try again.&messageType=error`);
        }
        
        if (req.teams[team].totalIncorrectAttempts >= 3) {
            req.teams[team].disqualified = true;
            if (!saveTeams(req.teams)) {
                return res.redirect(`/dashboard.html?team=${team}&message=System error. Please try again.&messageType=error`);
            }
            return res.redirect(`/dashboard.html?team=${team}&message=Too many incorrect attempts (3/3). Your team is disqualified.&messageType=error`);
        }
        
        let message = `Invalid clue code. Attempts remaining: ${attemptsLeft}.`;
        if (attemptsLeft === 2) message = "Invalid code! 2 attempts remaining.";
        if (attemptsLeft === 1) message = "Invalid code! Last attempt remaining!";
        
        return res.redirect(`/dashboard.html?team=${team}&message=${encodeURIComponent(message)}&messageType=error`);
    }

    // Get the specific clue object
    const codeData = req.codes[codeIndex];
    
    // Initialize teams array if it doesn't exist
    if (!Array.isArray(codeData.teams)) {
        codeData.teams = [];
    }

    // Check if already completed
    if (codeData.completedBy && codeData.completedBy.includes(team)) {
        return res.redirect(`/dashboard.html?team=${team}&message=You already completed this clue.&messageType=info`);
    }

    // Check if locked by another team
    if (codeData.locked) {
        return res.redirect(`/dashboard.html?team=${team}&message=This clue has been completed by another team.&messageType=info`);
    }

    // NEW: Get count of teams currently working on this clue
    const teamsWorkingOnClue = Object.values(req.teams).filter(t => 
        t.currentClue === clueCode && 
        (!codeData.completedBy || !codeData.completedBy.includes(t))
    ).length;

    // NEW: Check if maximum teams (3) are already working on this clue
    if (teamsWorkingOnClue >= 3) {
        return res.redirect(`/dashboard.html?team=${team}&message=Maximum teams (3) already working on this clue. Try another one.&messageType=error`);
    }

    // Add team to teams array if not already present
    if (!codeData.teams.includes(team)) {
        codeData.teams.push(team);
        console.log(`Added ${team} to teams array for clue ${clueCode}`);
    }

    // Reset incorrect attempts counter
    req.teams[team].totalIncorrectAttempts = 0;
    
    // Update team's current clue
    req.teams[team].currentClue = codeData.code;

    // Save changes to BOTH files
    if (!saveTeams(req.teams) || !saveCodes(req.codes)) {
        return res.redirect(`/dashboard.html?team=${team}&message=System error. Please try again.&messageType=error`);
    }

    console.log(`Redirecting ${team} to map for clue ${clueCode}`);
    res.redirect(`/map.html?lat=${codeData.location.lat}&lng=${codeData.location.lng}&team=${team}&code=${codeData.code}`);
});

// Verify clue at location
app.post('/verify-clue', (req, res) => {
    const { team, clueCode, enteredCode } = req.body;
    
    console.log(`Verify attempt: Team=${team}, Clue=${clueCode}, Code=${enteredCode}`);

    // Validate team
    if (!team || !req.teams[team]) {
        console.error('Invalid team:', team);
        return res.status(400).json({ success: false, message: "Invalid team." });
    }

    // Find the clue
    const codeIndex = req.codes.findIndex(c => c.code === clueCode);
    if (codeIndex === -1) {
        console.error('Clue not found:', clueCode);
        return res.status(400).json({ success: false, message: "Invalid clue code." });
    }
    const codeData = req.codes[codeIndex];

    // Check verification code
    if (enteredCode !== codeData.verificationCode) {
        console.log('Incorrect verification code');
        return res.status(200).json({ 
            success: false, 
            message: "Incorrect code. Please try again." 
        });
    }

    // Initialize completedBy if doesn't exist
    if (!Array.isArray(codeData.completedBy)) {
        codeData.completedBy = [];
    }

    // Initialize teams if doesn't exist
    if (!Array.isArray(codeData.teams)) {
        codeData.teams = [];
    }

    // Only proceed if team hasn't completed this before
    if (!codeData.completedBy.includes(team)) {
        console.log(`Recording completion for team ${team}`);
        codeData.completedBy.push(team);

        // Add team to teams[] if not already there
        if (!codeData.teams.includes(team)) {
            codeData.teams.push(team);
        }

        // Award points if first completion
        if (codeData.completedBy.length === 1) {
            req.teams[team].points += 100;
            codeData.locked = true;
            console.log(`Awarded 100 points to ${team} for first completion`);
        }
        
        // Clear current clue now that it's completed
        req.teams[team].currentClue = null;
        
        // Save changes
        if (!saveTeams(req.teams) || !saveCodes(req.codes)) {
            console.error('Failed to save data');
            return res.status(500).json({ success: false, message: "Error saving progress" });
        }
        
        console.log('Updated clue:', codeData);
    }

    res.status(200).json({
        success: true,
        points: req.teams[team].points,
        message: codeData.completedBy.length === 1 
            ? "✅ Bomb defused! 100 points awarded!" 
            : "Clue verified!"
    });
});

// Admin endpoints
app.get('/admin-teams', (req, res) => {
    res.json(req.teams);
});

app.get('/admin-clues', (req, res) => {
    res.json(req.codes);
});

app.get('/debug-clue/:code', (req, res) => {
    const codeData = req.codes.find(c => c.code === req.params.code);
    if (!codeData) {
        return res.status(404).send('Clue not found');
    }
    res.json({
        clue: codeData,
        teams: Object.keys(req.teams).filter(team => 
            req.teams[team].currentClue === req.params.code
        )
    });
});

// Team management
app.post('/create-team', (req, res) => {
    const { name, password } = req.body;
    
    if (!name || !password) {
        return res.status(400).send("Team name and password are required.");
    }
    
    if (req.teams[name]) {
        return res.status(400).send("Team already exists.");
    }
    
    req.teams[name] = { ...DEFAULT_TEAM, password };
    if (!saveTeams(req.teams)) {
        return res.status(500).send("Error creating team.");
    }
    res.send("Team created successfully.");
});

app.post('/reset-team', (req, res) => {
    const { team } = req.body;
    
    if (!team || !req.teams[team]) {
        return res.status(400).send("Invalid team.");
    }
    
    // Clean up all clue references
    req.codes.forEach(clue => {
        // Reset teams array if it only contained this team
        if (clue.teams && clue.teams.includes(team)) {
            clue.teams = clue.teams.filter(t => t !== team);
            if (clue.teams.length === 0) {
                clue.teams = []; // Ensure empty array
            }
        }
        
        // Clean completedBy
        if (clue.completedBy && clue.completedBy.includes(team)) {
            clue.completedBy = clue.completedBy.filter(t => t !== team);
            if (clue.completedBy.length === 0) {
                clue.locked = false;
            }
        }
    });
    
    // Reset team data
    req.teams[team] = { 
        ...DEFAULT_TEAM,
        password: req.teams[team].password 
    };
    
    if (!saveTeams(req.teams) || !saveCodes(req.codes)) {
        return res.status(500).send("Error saving data");
    }
    
    res.send("Team reset successfully. Clue counts updated.");
});

app.post('/reset-all', (req, res) => {
    // Reset all teams
    for (const team in req.teams) {
        req.teams[team] = { ...DEFAULT_TEAM, password: req.teams[team].password };
    }
    if (!saveTeams(req.teams)) {
        return res.status(500).send("Error resetting teams.");
    }
    
    // Reset all clues
    req.codes.forEach(clue => {
        clue.completedBy = [];
        clue.locked = false;
    });
    if (!saveCodes(req.codes)) {
        return res.status(500).send("Error resetting clues.");
    }
    
    res.send("All teams and clues reset successfully.");
});

app.post('/reset-points', (req, res) => {
    // Reset points for all teams
    for (const team in req.teams) {
        req.teams[team].points = 0;
    }
    if (!saveTeams(req.teams)) {
        return res.status(500).send("Error resetting points.");
    }
    
    res.send("All points reset successfully.");
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Optional: Clear all sessions on server restart
    if (fs.existsSync(DATA_DIR + '/sessions')) {
      fs.rmSync(DATA_DIR + '/sessions', { recursive: true });
    }
  });
