const config = require('./config');
const gnugoExecutor = require('./gnugoExecutor');

function getValueFromOutput(output, propertyName, positionFromEnd = 1) {
    const strs = output.find((line) => {
        return line.includes(propertyName);
    });

    if (strs === undefined) {
        return null;
    }

    let strsSplit = strs.split(' ');
    strsSplit = strsSplit.filter((s) => {
        return s.length > 0;
    });
    return strsSplit[strsSplit.length - positionFromEnd];
}

function getLastValueFromOutput(output, propertyName, positionFromEnd = 1) {
    const strs = output.filter((line) => {
        return line.includes(propertyName);
    });

    if (strs === undefined || strs.length === 0) {
        return null;
    }

    const strsSplit = strs[strs.length - 1].split(' ');
    return strsSplit[strsSplit.length - positionFromEnd];
}

function getValueFromOutputStart(output, propertyName, positionFromStart = 0) {
    const strs = output.find((line) => {
        return line.includes(propertyName);
    });

    if (strs === undefined || strs === null) {
        return null;
    }

    const strsSplit = strs.split(' ');
    return strsSplit[positionFromStart];
}

// E.g. W+50.5
function getGameResultFromString(gameResultString) {
    if (gameResultString === undefined || gameResultString === null || gameResultString.length === 0) {
        return null;
    }

    const gameResultSplit = gameResultString.split('+');

    let winner;
    if (gameResultSplit[0] === 'B') {
        winner = 1;
    } else if (gameResultSplit[0] === 'W') {
        winner = 2;
    }

    const resigned = (gameResultSplit[1] === 'R' || gameResultSplit[1] === 'Resign');

    let score = null;
    if (!isNaN(gameResultSplit[1])) {
        score = parseFloat(gameResultSplit[1]);

        // Round up to the nearest integer, so it reads more naturally.
        score = Math.ceil(score);
    }

    const gameResult = {
        'winner': winner,
        'resigned': resigned,
        'score': score,
        'isGameOver': true,
    };

    return gameResult;
}

// Get score info/game result from the SGF directly, assuming the result is written into the first node.
function getGameResultFromSgf(sgfContents) {
    const RESULT_SGF_KEY = 'RE[';
    if (!sgfContents.includes(RESULT_SGF_KEY)) {
        return null;
    }

    return getGameResultFromString(sgfContents.split(RESULT_SGF_KEY)[1].split(']')[0]);
}

// Get score info/game result from the output.
function getGameResultFromOutput(output) {
    return getGameResultFromString(getValueFromOutput(output, 'Result:'));
}

// Get score info from SGF by executing the scoring function. This is required when the game result isn't explicitly added into the SGF file
// (at the end of each game). This is a limitation of gnugo.
function getScoreInfoFromSgf(inputSgfFilename, inputSgfString, callback) {
    gnugoExecutor.executeGetScore(inputSgfFilename, (output) => {
        const gameResult = getGameResultFromSgf(inputSgfString);
        if (gameResult !== null) {
            callback(gameResult);
        } else {
            output = output.toString().split('\n');

            let score = parseFloat(getValueFromOutput(output, 'point', 2));

            // Round up to the nearest integer, so it reads more naturally.
            score = Math.ceil(score);

            let winner;
            const winnerColor = getValueFromOutputStart(output, 'point').toLowerCase();
            if (winnerColor === 'black') {
                winner = 1;
            } else if (winnerColor === 'white') {
                winner = 2;
            }

            const scoreInfo = {
                'winner': winner,
                'score': score,
                'resigned': false,
                'isGameOver': false,
            };

            callback(scoreInfo);
        }
    });
}

function isCoordinateRow(line) {
    return line.includes('A B C D E');
}

function getNextBoardValuesFromOutput(output) {
    const topCoordinateIndex = output.findIndex((line) => {
        return isCoordinateRow(line);
    });

    const bottomCoordinateIndex = output.findIndex((line, index) => {
        return isCoordinateRow(line) && index > topCoordinateIndex;
    });

    const boardRows = output.slice(topCoordinateIndex + 1, bottomCoordinateIndex);

    // Format ASCII board in output into an array of ints.
    //
    // Example input:
    // ['  7 X O . . . . . 7',
    //  '  6 . X . . . . . 6',
    //  '  5 X . + . +(O). 5',
    //  '  4 . . . + . . . 4',
    //  '  3 . . + . O . . 3',
    //  '  2 . . . . . . . 2',
    //  '  1 . . . . . . . 1']
    //
    // Example output
    // [ [ 1, 2, 0, 0, 0, 0, 0 ],
    //   [ 0, 1, 0, 0, 0, 0, 0 ],
    //   [ 1, 0, 0, 0, 0, 2, 0 ],
    //   [ 0, 0, 0, 0, 0, 0, 0 ],
    //   [ 0, 0, 0, 0, 2, 0, 0 ],
    //   [ 0, 0, 0, 0, 0, 0, 0 ],
    //   [ 0, 0, 0, 0, 0, 0, 0 ] ]
    const boardValues = boardRows.map((line) => {
        return line
            .substr(3)
            .slice(0, -2)
            .replace(/ /g, '')
            .replace(/\(/g, '')
            .replace(/\)/g, '')
            .split('')
            .map((chr) => {
                if (chr === 'X') {
                    return 1;
                } else if (chr === 'O') {
                    return 2;
                }

                return 0;
            });
    });

    return boardValues;
}

// Get a list of board values from output. Each board will be an array in the resulting array.
function getAllBoardValuesFromOutput(output) {
    const coordinates = [];

    while (true) {
        // Returns -1 if no value is found.
        const topCoordinateIndex = output.findIndex((line, index) => {
            return isCoordinateRow(line) && (coordinates.length === 0 || index > coordinates[coordinates.length - 1][1]);
        });

        // Returns -1 if no value is found.
        const bottomCoordinateIndex = output.findIndex((line, index) => {
            return isCoordinateRow(line) && index > topCoordinateIndex;
        });

        if (topCoordinateIndex === -1 || bottomCoordinateIndex === -1) {
            break;
        }

        coordinates.push([topCoordinateIndex, bottomCoordinateIndex]);
    }

    return coordinates.map(([topCoordinateIndex, bottomCoordinateIndex]) => {
        const nextOutputChunk = output.slice(topCoordinateIndex, bottomCoordinateIndex + 1);
        const nextBoardValues = getNextBoardValuesFromOutput(nextOutputChunk);
        return nextBoardValues;
    });
}

// Return if the output contains an illegal move.
// TODO: Separate illegal from invalid?
//
// Example line from output:
// 'WARNING: Move off board or on occupied position found in sgf-file.'
function isBoardIllegalFromOutput(output) {
    return output.some((line) => {
        return line.includes('Illegal');
    }) || output.some((line) => {
        return line.includes('Invalid');
    });
}

function getBoardSizeFromOutput(output) {
    return parseInt(getValueFromOutput(output, 'Board Size'));
}

// function getWhitePrisonersFromOutput(output) {
//     return parseInt(getLastValueFromOutput(output, 'White (O) has captured', 2));
// }
// function getBlackPrisonersFromOutput(output) {
//     return parseInt(getLastValueFromOutput(output, 'Black (X) has captured', 2));
// }

// E.g. The AI Move
function getLastMoveCoordinatesFromOutput(output) {
    const lastMoveString = getLastValueFromOutput(output, 'Last move');

    if (lastMoveString === null) {
        return null;
    }

    if (lastMoveString.toUpperCase() === 'PASS') {
        return [];
    }

    const boardSize = getBoardSizeFromOutput(output);

    // Get the translated y coordinate. Example, for R17, y=0
    const y = boardSize - parseInt(lastMoveString.slice(1, 3));

    // Get the translated x coordinate. Subtract 1 for values over 8 since gnugo skips 'I'. Example, for R17, x=16
    let x = lastMoveString.slice(0, 1).charCodeAt(0) - 'A'.charCodeAt(0);
    if (x >= 8) {
        x = x - 1;
    }

    return [y, x];
}

function getLastMoveStringFromOutput(output) {
    // If game is over, check for a result string first.
    const resignString = getValueFromOutput(output, 'Result:');
    if (resignString === 'B+Resign') {
        return 'RESIGN';
    }

    // If game isn't over, get coordinates and infer move.
    const coordinates = getLastMoveCoordinatesFromOutput(output);
    if (coordinates === null) {
        return 'no position';
    }

    if (coordinates.length === 0) {
        return 'PASS';
    }
    const y = coordinates[0];
    const x = coordinates[1];

    const boardSize = getBoardSizeFromOutput(output);

    const letter = String.fromCharCode('A'.charCodeAt(0) + x);
    const number = boardSize - y;
    const lastMoveString = `${letter} ${number}`;

    return lastMoveString;
}

function getGameOptionsFromSgfContents(sgfContents) {
    const firstNodeContents = sgfContents.split(';')[1];

    function getValueFromSgfCommon(preString, postString) {
        if (firstNodeContents === undefined || firstNodeContents === null || !firstNodeContents.includes(preString)) {
            return null;
        }

        const afterPreString = firstNodeContents.split(preString)[1];

        if (!afterPreString.includes(postString)) {
            return null;
        }

        return afterPreString.split(postString)[0];
    }

    function getValueFromSgf(key) {
        return getValueFromSgfCommon(`${key}[`, ']');
    }

    function getValueFromSgfComment(key) {
        return getValueFromSgfCommon(`${key}="`, '"');
    }

    function getValueFromSgfGNEnd(key) {
        return getValueFromSgfCommon(`${key} `, ']');
    }

    const boardSize = parseInt(getValueFromSgf('SZ'));
    const handicap = parseFloat(getValueFromSgf('HA'));
    const komi = parseFloat(getValueFromSgf('KM'));
    const rules = getValueFromSgf('RU');
    const level = parseInt(getValueFromSgfGNEnd('level'));
    const color = getValueFromSgfComment('COLOR');

    return config.getGameOptions(boardSize, color, handicap, komi, level, rules);
}

// TODO: Define boardInfo in a separate common place? Rename this file boardInfoGetter.js?
function getBoardInfoFromOutput(outputContents, sgfContents) {
    const output = outputContents.toString().split('\n');

    const allBoardValues = getAllBoardValuesFromOutput(output);

    const boardInfo = {
        'currentBoardValues': allBoardValues[0],
        'newBoardValues': allBoardValues[allBoardValues.length - 1],
        'isBoardIllegal': isBoardIllegalFromOutput(output),
        'gameOptions': getGameOptionsFromSgfContents(sgfContents),
        'lastMoveCoordinates': getLastMoveCoordinatesFromOutput(output),
        'lastMoveString': getLastMoveStringFromOutput(output),
        // 'whitePrisoners': getWhitePrisonersFromOutput(output),
        // 'blackPrisoners': getBlackPrisonersFromOutput(output),
        'currentGameResult': getGameResultFromSgf(sgfContents),
        'newGameResult': getGameResultFromOutput(output),
        'currentSgfContents': sgfContents.toString(),
    };

    return boardInfo;
}

// Callback(boardInfo)
function getInitialBoardInfo(outputSgfFilename, gameOptions = config.DEFAULT_GAME_OPTIONS, callback) {
    gnugoExecutor.executeInitializeBoard(outputSgfFilename, gameOptions, (outputContents) => {
        const boardInfo = getBoardInfoFromOutput(outputContents, '');
        callback(boardInfo);
    });
}

function getCurrentBoardInfo(inputSgfFilename, inputSgfContents, callback) {
    const gameOptions = getGameOptionsFromSgfContents(inputSgfContents);

    gnugoExecutor.executeGetBoard(inputSgfFilename, gameOptions, (outputContents) => {
        callback(getBoardInfoFromOutput(outputContents, inputSgfContents));
    });
}

// TODO: Move gameOptions into execute functions
function playerMoveGetBoardInfoFromSgf(move, inputSgfFilename, inputSgfContents, callback) {
    const gameOptions = getGameOptionsFromSgfContents(inputSgfContents);

    gnugoExecutor.executePlayerMove(move, inputSgfFilename, gameOptions, (outputContents) => {
        callback(getBoardInfoFromOutput(outputContents, inputSgfContents));
    });
}

function playerPassGetBoardInfoFromSgf(inputSgfFilename, inputSgfContents, callback) {
    const gameOptions = getGameOptionsFromSgfContents(inputSgfContents);

    gnugoExecutor.executePlayerPass(inputSgfFilename, gameOptions, (outputContents) => {
        callback(getBoardInfoFromOutput(outputContents, inputSgfContents));
    });
}

function playerResignGetBoardInfoFromSgf(inputSgfFilename, inputSgfContents, callback) {
    const gameOptions = getGameOptionsFromSgfContents(inputSgfContents);

    gnugoExecutor.executePlayerResign(inputSgfFilename, gameOptions, (outputContents) => {
        callback(getBoardInfoFromOutput(outputContents, inputSgfContents));
    });
}

function playerUndoGetBoardInfoFromSgf(inputSgfFilename, inputSgfContents, callback) {
    const gameOptions = getGameOptionsFromSgfContents(inputSgfContents);

    gnugoExecutor.executeUndoMoves(inputSgfFilename, gameOptions, (outputContents) => {
        callback(getBoardInfoFromOutput(outputContents, inputSgfContents));
    });
}

module.exports = module.exports = {
    'getScoreInfoFromSgf': getScoreInfoFromSgf,
    'getInitialBoardInfo': getInitialBoardInfo,
    'getCurrentBoardInfo': getCurrentBoardInfo,
    'playerMoveGetBoardInfoFromSgf': playerMoveGetBoardInfoFromSgf,
    'playerPassGetBoardInfoFromSgf': playerPassGetBoardInfoFromSgf,
    'playerResignGetBoardInfoFromSgf': playerResignGetBoardInfoFromSgf,
    'playerUndoGetBoardInfoFromSgf': playerUndoGetBoardInfoFromSgf,
    'getGameOptionsFromSgfContents': getGameOptionsFromSgfContents,
};
