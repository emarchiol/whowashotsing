const fs = require("fs");
const path = require("path");
const heroprotocol = require("heroprotocol");
require('dotenv').config();
const Tesseract = require('tesseract.js');
const sharp = require("sharp");
const stringSimilarity = require('string-similarity');
const chokidar = require('chokidar');

const REPLAY_DIR = process.env.HOTS_REPLAY_PATH;
const KNOWN_PLAYERS = process.env.HOTS_KNOWN_PLAYERS?.split(',').map(player => player.trim()) || [];
const AMOUNT_OF_REPLAYS = process.env.AMOUNT_OF_REPLAYS || 3;
const HOTS_SCREENSHOTS_PATH = process.env.HOTS_SCREENSHOTS_PATH;
const PLAYER_NAME = process.env.MY_PLAYER_NAME;

// Read the file synchronously
const heroesFile = fs.readFileSync('heroes.json', 'utf8');
// Parse the JSON string into a JavaScript array
const ALL_HEROES = JSON.parse(heroesFile);

// Function to get the latest replay files
function getLastReplayFiles(directory, count = AMOUNT_OF_REPLAYS) {
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

async function cropTeamNames(fileName, resolutionWidth, resolutionHeight, isFriendlyTeam) {
    // This needs to be done from the resolution
    // Based on the resolution I have the following ratio 
    // For 1920x1080
    // First useless rectangle 23.5% -> 250 (until first name)
    // Main heroes rectangle 61%
    // Last useless rectangle 20%
    // Each hero rectangle is about 12.25%

    // Calculate the starting point with first rectangle
    // Calculate the pixels for each 12.25% rectangle

    const inputPath = fileName;
    const playerNames = [];
    // 132.5
    // 530
    
    // Crop starting points
    const left = Math.ceil((resolutionWidth * (isFriendlyTeam ? 5.7 : 84.5))/100);
    const width = Math.ceil((resolutionWidth * 9.90)/100);

    const height = Math.ceil((resolutionHeight * 4.16)/100);
    // Top Starting point for each player
    const top = (resolutionHeight * 22.68)/100;
    const topStartingPoint = top;
    const topStartingPoint2 = top + ((resolutionHeight * 12.25)/100);
    const topStartingPoint3 = top + (((resolutionHeight * 12.25)/100)*2);
    const topStartingPoint4 = top + (((resolutionHeight * 12.25)/100)*3);
    const topStartingPoint5 = top + (((resolutionHeight * 12.25)/100)*4);

    const playersTopStartingPoint = [
        Math.ceil(topStartingPoint),
        Math.ceil(topStartingPoint2),
        Math.ceil(topStartingPoint3),
        Math.ceil(topStartingPoint4),
        Math.ceil(topStartingPoint5),
    ];

    // console.log('TEAM FRIEND: ', isFriendlyTeam);
    // console.log('left: ', left);
    // console.log('width: ', width);
    // console.log('height: ', height);
    // console.log('playersTopStartingPoint: ', playersTopStartingPoint);


    for (let playerNumber = 0; playerNumber < playersTopStartingPoint.length; playerNumber++) {
        const teamSide = isFriendlyTeam ? 'friendly' : 'enemy';
        const processedPath = `processed_screenshot/processed_${teamSide}_${playerNumber}.png`;
        const topStartingPoint = playersTopStartingPoint[playerNumber];

        const playerCoordinates = {
            left,
            top: topStartingPoint,
            width,
            height,
        }

        // Enemy team as default
        // let playerCoordinates = {
        //     left: 1630,
        //     top: topStartingPoint,
        //     width: 180,
        //     height: 45,
        // }

        // if(isFriendlyTeam) {
        //     playerCoordinates = {
        //         left: 110,
        //         top: topStartingPoint,
        //         width: 200,
        //         height: 45,
        //     }
        // }

        await sharp(inputPath)
            .extract(playerCoordinates)
            .tint({ r: 0, g: 100, b: 0 })
            .toFile(processedPath);

        const extractedData = await Tesseract.recognize(
            processedPath,     // Local file or URL
            'eng',
            {
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE, // Optional: layout mode
                // logger: m => console.log(m), // Optional: progress log
            }
        );

        // Extract the hero name from the json
        const extractedDirtyHeroName = extractedData.data.text.split('\n')[0]?.trim();
        const heroName = extractedDirtyHeroName.replace(/[^a-zA-Z]/g, '').toLowerCase();
        const allHeroesDb = ALL_HEROES.map(hero => hero.name);
        const hero = stringSimilarity.findBestMatch(heroName, allHeroesDb).bestMatch;
        
        const playerInfo = {
            heroName: hero?.target,
            playerName: extractedData.data.text.split('\n')[1]?.trim(),
        }

        playerNames.push(playerInfo);
    }

    // Don't show partial results
    if(!playerNames[0].heroName || 
       !playerNames[1].heroName || 
       !playerNames[2].heroName ||
       !playerNames[3].heroName ||
       !playerNames[4].heroName) {
            return null;
    }

    return playerNames;
}

async function extractGameResolution() {
    // Mocked
    // Look into C:\Users\emili\Documents\Heroes of the Storm\Variables.txt -> width and height (width=2560, height=1440)
    return {
        width: 2560,
        height: 1440
    }
}

function extractLastScreenshotFilePath(folderPath) {
    return new Promise((resolve, reject) => {
       console.log(`Watching for game loading screenshots in directory: ${folderPath}`);
       const watcher = fs.watch(folderPath, (eventType, filename) => {
            if (filename) {
                console.log(`Change detected: ${filename} (${eventType}), loading info from screenshot...`);
                watcher.close();
                resolve(`${folderPath}\\\\${filename}`);
                // resolve('test_screenshots\screenshot.jpeg');
            }
        });
        watcher.on('error', (error) => {
            console.error('Error watching directory:', error);
            reject(error);
        });
    });
}

function getPlayersFromReplays() {
    if(!REPLAY_DIR || !fs.existsSync(REPLAY_DIR)) {
        console.error("Replay directory does not exist or is not set in the environment variables.");
        throw new Error("Replay directory not found");
    }
    const replayFiles = getLastReplayFiles(REPLAY_DIR, AMOUNT_OF_REPLAYS);
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
        console.log('\n\x1b[34m%s\x1b[0m', `Friendly Team:`);
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

    return allPlayersName;
}

async function getCurrentGameInfo(){
    // CURRENT GAME INFO

    // Extract game resolution
    const resolution = await extractGameResolution();

    // Check if screenshots directory is updated.
    const screenshotFilePath = await extractLastScreenshotFilePath(HOTS_SCREENSHOTS_PATH);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for the screenshot to be ready
    const currentGameFriendlyTeam = await cropTeamNames(screenshotFilePath, resolution.width, resolution.height, true);
    const currentGameEnemyTeam = await cropTeamNames(screenshotFilePath, resolution.width, resolution.height, false);

    // Don't show incomplete extractions
    if(!currentGameFriendlyTeam || !currentGameEnemyTeam) {
        return;
    }

    return [currentGameFriendlyTeam, currentGameEnemyTeam];
}

function printCurrentGameInfo(currentPlayersInfo) {
    if(currentPlayersInfo?.length > 1) {
        console.log(`\n*******************`);
        console.log(`CURRENT GAME INFO`);
        console.log(`*******************`);

        const leftTeamIsFriendly = currentPlayersInfo[0].some(player => PLAYER_NAME === player.playerName);

        printTeamInfo(currentPlayersInfo[0], leftTeamIsFriendly);
        printTeamInfo(currentPlayersInfo[1], leftTeamIsFriendly);

        console.log(`\n===================`);
    }
}

function printTeamInfo(team, leftTeamIsFriendly) {
    console.log(`\x1b[${leftTeamIsFriendly ? 34 : 31}m%s\x1b[0m`, leftTeamIsFriendly ? `Friendly Team:` : `Enemy Team:`);
    team.forEach(player => {
        if (KNOWN_PLAYERS.includes(player.playerName)) {
            console.log('\x1b[32m%s\x1b[0m', `  - ${player.heroName} (${player.playerName})`);
        } else {
            if (allPastPlayersInfo.includes(player.playerName)) {
                console.log('\x1b[33m%s\x1b[0m', `  - ${player.heroName} (${player.playerName})`);
            } else {
                console.log(`  - ${player.heroName} (${player.playerName})`);
            }
        }
    });
}

// Main function
async function main() {
    // Get past replay players info.
    const allPastPlayersInfo = getPlayersFromReplays();

    // Get current game info
    const currentPlayersInfo = await getCurrentGameInfo();
}

// Run the script
main();
