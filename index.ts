const fs = require("fs");
const path = require("path");
const heroprotocol = require("heroprotocol");
require('dotenv').config();

const REPLAY_DIR = process.env.HOTS_REPLAY_PATH;
const KNOWN_PLAYERS = process.env.HOTS_KNOWN_PLAYERS?.split(',').map(player => player.trim()) || [];

// Function to get the latest replay files
function getLastReplayFiles(directory, count = 3) {
    const files = fs.readdirSync(directory)
        .filter(file => file.endsWith(".StormReplay"))
        .map(file => ({
            filePath: path.join(directory, file),
            mtime: fs.statSync(path.join(directory, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime) // Sort by last modified time
        .slice(0, count);

    return files.map(f => f.filePath);
}

// Function to extract player names from a replay file
function extractPlayers(replayFile) {
    try {
        const details = heroprotocol.get(heroprotocol.DETAILS, replayFile);
        const enemyTeam = details.m_playerList.filter(player => player.m_teamId === 0).map(player => {
            return {
                name: player.m_name,
                hero: player.m_hero,
                team: player.m_teamId
            }
        });
        const friendlyTeam = details.m_playerList.filter(player => player.m_teamId === 1).map(player => {
            return {
                name: player.m_name,
                hero: player.m_hero,
                team: player.m_teamId
            }
        });

        let isFriendlyTeam = false;
        // Check if known players are in the team
        enemyTeam.forEach(player => {
            if (KNOWN_PLAYERS.includes(player.name)) {
                isFriendlyTeam = true;
            }
        });
        if(isFriendlyTeam) {
            return [friendlyTeam, enemyTeam];
        }
        
        return [enemyTeam, friendlyTeam];
    } catch (error) {
        console.error(`Error reading ${replayFile}:`, error.message);
        return [];
    }
}

// Function to extract map name from a replay file
function extractMapName(replayFile) {
    try {
        const details = heroprotocol.get(heroprotocol.DETAILS, replayFile);
        return details.m_title;
    } catch (error) {
        console.error(`Error reading ${replayFile}:`, error.message);
        return [];
    }
}

// Main function
function main() {
    const replayFiles = getLastReplayFiles(REPLAY_DIR, 20);
    let allPlayersName = [];
    replayFiles.reverse().forEach(replayFile => {
        const mapName = extractMapName(replayFile);
        const players = extractPlayers(replayFile);
        
        console.log(`\n*******************`);
        console.log(`Map: ${mapName}`);
        console.log(`*******************`);
        
        // Enemy Team:
        console.log('\x1b[31m%s\x1b[0m',`Enemy Team`);
        
        players[0].forEach(player => {
            if(allPlayersName.includes(player.name)) {
                console.log('\x1b[33m%s\x1b[0m', `  - ${player.hero} (${player.name})`);
            } else {
                console.log(`  - ${player.hero} (${player.name})`);
                allPlayersName.push(player.name);
                allPlayersName = allPlayersName.flat();
            }
        });

        // Friendly Team:
        console.log('\x1b[34m%s\x1b[0m', `Friendly Team:`);
        players[1].forEach(player => {
            if (!KNOWN_PLAYERS.includes(player.name) && allPlayersName.includes(player.name)) {
                console.log('\x1b[33m%s\x1b[0m',`  - ${player.hero} (${player.name})`);
            } else if(!KNOWN_PLAYERS.includes(player.name)) {
                console.log(`  - ${player.hero} (${player.name})`);
                allPlayersName.push(player.name);
                allPlayersName = allPlayersName.flat();
            }
        });
        console.log(`-------------------`);
        // Known players
        players[1].forEach(player => {
            if (KNOWN_PLAYERS.includes(player.name)) {
                console.log('\x1b[32m%s\x1b[0m', `  - ${player.hero} (${player.name})`);
            }
        });
        console.log(`\n===================`);
    });
}

// Run the script
main();
