const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const gnugoParser = require('./gnugoParser');

AWS.config.update({region: 'us-west-2'});

function appendInitialComment(sgfContents, color) {
    const cleanSgfContents = sgfContents.toString().replace(/\n/g, '').trim();

    // If comments already in Sgf, don't write it again.
    // TODO: Why is this necessary?
    if (cleanSgfContents.includes('C[VERSION')) {
        return cleanSgfContents;
    }

    const initialComment = `C[VERSION="1.0" MODE="AI" COLOR="${color}"]`;

    sgfSplit = cleanSgfContents.split(';');
    sgfSplit[1] = initialComment.concat(sgfSplit[1]);
    return sgfSplit.join(';');
}

function isSgfGameOver(sgfString) {
    return sgfString.includes('RE[');
}

function hasUndoneMoves(sgfContents) {
    return sgfContents.split(';').filter((value) => value.includes('C[undone]') ).length === 2;
}

// Check that exactly two moves are undone
function removeUndoneMovesFromSgf(sgfContents) {
    return sgfContents.split(';').filter((value) => !value.includes('C[undone]') ).join(';');
}

function generateUniqueFilename() {
    let result = '';

    for (let j = 0; j < 16; j++) {
        result += Math.floor(Math.random() * 16).toString(16).toUpperCase();
    }

    return result;
}

function getRandomSgfFilename() {
    return path.join(os.tmpdir(), generateUniqueFilename() + '.sgf');
}

// Callback(boardInfo, err)
function initializeBoardWithDiskHandling(gameOptions, callback) {
    const randomFilename = getRandomSgfFilename();

    gnugoParser.getInitialBoardInfo(randomFilename, gameOptions, (boardInfo) => {
        fs.readFile(randomFilename, (readErr, outputSgfContents) => {
            if (readErr !== null) {
                console.log('FS READ ERROR:', readErr);
                callback(null, readErr);
                return;
            }

            // NOTE: The previous gameOptions is invalid, since the input SGF contents were null.
            boardInfo.gameOptions = gameOptions;

            boardInfo['newSgfContents'] = appendInitialComment(outputSgfContents, boardInfo.gameOptions.color);

            // Remove random file, to avoid running out of space on lambda
            fs.unlink(randomFilename, (unlinkErr) => {
                if (unlinkErr !== null) {
                    console.log('FS UNLINK ERROR:', unlinkErr);
                }

                callback(boardInfo, unlinkErr);
            });
        });
    });
}

// gnugoParserFunction accepts (inputFilename, inputSgfContents, callback(boardInfo, err))
function getBoardInfoViaDiskHandling(inputSgfContents, gnugoParserFunction, callback) {
    const randomFilename = getRandomSgfFilename();

    // Write initial file
    fs.writeFile(randomFilename, inputSgfContents, (writeErr) => {
        if (writeErr !== null) {
            console.log('FS WRITE ERROR:', writeErr);
            callback(null, writeErr);
            return;
        }

        gnugoParserFunction(randomFilename, inputSgfContents, (boardInfo) => {
            fs.readFile(randomFilename, (readErr, outputSgfContents) => {
                if (readErr !== null) {
                    console.log('FS READ ERROR:', readErr);
                    callback(boardInfo, readErr);
                    return;
                }

                boardInfo['newSgfContents'] = appendInitialComment(outputSgfContents, boardInfo.gameOptions.color);

                // Remove random file, to avoid running out of space on lambda
                fs.unlink(randomFilename, (unlinkErr) => {
                    if (unlinkErr !== null) {
                        console.log('FS UNLINK ERROR:', unlinkErr);
                    }

                    callback(boardInfo, unlinkErr);
                });
            });
        });
    });
}

// Callback(boardInfo, err)
function getScoreInfoViaDiskHandling(inputSgf, callback) {
    const randomFilename = getRandomSgfFilename();

    // Write initial file
    fs.writeFile(randomFilename, inputSgf, (writeErr) => {
        if (writeErr !== null) {
            console.log('FS WRITE ERROR:', writeErr);
            callback(null, writeErr);
            return;
        }

        gnugoParser.getScoreInfoFromSgf(randomFilename, inputSgf, (scoreInfo) => {
            // Remove random file, to avoid running out of space on lambda
            fs.unlink(randomFilename, (unlinkErr) => {
                if (unlinkErr !== null) {
                    console.log('FS UNLINK ERROR:', unlinkErr);
                }

                callback(scoreInfo, unlinkErr);
            });
        });
    });
}

// callback(data, err);
function writeAccountGameToDB(userId, sgfGame, callback) {
    const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

    // TODO: Store constants in config
    const params = {
        TableName: 'GoGameAlexaSkillGames',
        Item: {
            'accountId': {S: userId},
            'sgfGame': {S: sgfGame},
        },
    };

    // Call DynamoDB to add the item to the table
    ddb.putItem(params, function(err, data) {
        if (err !== null) {
            console.log('DS PUTITEM ERROR', err);
        }

        callback(data, err);
    });
}

// Callback(boardInfo, err)
function initAndWriteBoard(userId, callback, gameOptions = config.DEFAULT_GAME_OPTIONS) {
    initializeBoardWithDiskHandling(gameOptions, (boardInfo, err) => {
        if (err !== null) {
            callback(null, err);
            return;
        }

        writeAccountGameToDB(userId, boardInfo.newSgfContents, (data, err) => {
            callback(boardInfo, err);
        });
    });
}

// If initializeFlag is true, then initialize and write board into DB before returning contents.
// Callback(currentSgfContents, err)
function readAccountGameFromDB(userId, callback, initializeFlag = true) {
    const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

    // TODO: Store constants in config
    const params = {
        TableName: 'GoGameAlexaSkillGames',
        Key: {
            'accountId': {S: userId},
        },
    };

    // Call DynamoDB to add the item to the table
    ddb.getItem(params, function(err, data) {
        if (err) {
            console.log('DS GETITEM ERROR', err);
            callback(null, err);
            return;
        }

        // If DB has an SGF, use it in the callback
        if ('Item' in data &&
            'sgfGame' in data.Item &&
            'S' in data.Item.sgfGame) {
            const currentSgfContents = data.Item.sgfGame.S;
            callback(currentSgfContents, null);

        // If DB doesn't have an SGF, get an initial board, write it, and then use it in the callback.
        } else if (initializeFlag) {
            initAndWriteBoard(userId, (boardInfo, err) => {
                if (err !== null) {
                    callback(null, err);
                } else {
                    callback(boardInfo.newSgfContents, err);
                }
            });
        } else {
            callback(null, null);
        }
    });
}

// Get initial board, or reset existing. Override current options with new ones.
// Callback(boardInfo, err)
function resetBoard(userId, newGameOptions, callback) {
    // Read from database and use result if this account has an entry already. Otherwise initialize one and write it in.
    readAccountGameFromDB(userId, (currentSgfContents, err) => {
        if (err !== null) {
            callback(null, err);
            return;
        }

        let gameOptions = config.DEFAULT_GAME_OPTIONS;

        if (currentSgfContents !== null) {
            gameOptions = gnugoParser.getGameOptionsFromSgfContents(currentSgfContents);
        }

        // Go through newGameOptions and override each key in the current gameOptions.
        if (newGameOptions !== null) {
            Object.keys(newGameOptions).forEach((key) => {
                gameOptions[key] = newGameOptions[key];
            });
        }

        initAndWriteBoard(userId, callback, gameOptions);
    }, false);
}

// If there is no board in the DB, write an initial blank board
// callback(boardInfo, err)
function getCurrentBoardInfo(userId, callback) {
    readAccountGameFromDB(userId, (currentSgfContents, err) => {
        if (err !== null) {
            callback(null, err);
        } else {
            getBoardInfoViaDiskHandling(currentSgfContents, gnugoParser.getCurrentBoardInfo, callback);
        }
    });
}

// 1. Read sgf from DB
// 2. Execute parser function and get output sgf from disk, board info from execution output
// 3. If game isn't over, write new output sgf to the DB
// 4. callback(boardInfo, isGameAlreadyOver, err)
function commonDiskDBParserCall(userId, gnugoParserFunction, callback) {
    readAccountGameFromDB(userId, (currentSgfContents, err) => {
        if (err !== null) {
            callback(null, false, err);
            return;
        }

        getBoardInfoViaDiskHandling(currentSgfContents, gnugoParserFunction, (boardInfo, err) => {
            if (err !== null) {
                callback(null, false, err);
                return;
            }

            // Don't write to DB if current game is already over, or new board is illegal.
            if (!isSgfGameOver(currentSgfContents) && !boardInfo.isBoardIllegal) {
                writeAccountGameToDB(userId, boardInfo.newSgfContents, (data, err) => {
                    callback(boardInfo, false, err);
                });
            } else {
                callback(boardInfo, true, null);
            }
        });
    });
}

// Callback(boardInfo, isGameAlreadyOver, err)
function placeStoneAddAIMove(userId, move, callback) {
    // Insert move into function, to create a callback with the expected format
    const gnugoParserFunction = (inputSgfFilename, inputSgfContents, boardInfoCallback) => {
        return gnugoParser.playerMoveGetBoardInfoFromSgf(move, inputSgfFilename, inputSgfContents, boardInfoCallback);
    };

    commonDiskDBParserCall(userId, gnugoParserFunction, callback);
}

// Callback(boardInfo, isGameAlreadyOver, err)
function passAddAIMove(userId, callback) {
    commonDiskDBParserCall(userId, gnugoParser.playerPassGetBoardInfoFromSgf, callback);
}

// Callback(boardInfo, isGameAlreadyOver, err)
function playerResigns(userId, callback) {
    commonDiskDBParserCall(userId, gnugoParser.playerResignGetBoardInfoFromSgf, callback);
}

// Callback(boardInfo, undoSuccessful, err)
function undoMoves(userId, callback) {
    readAccountGameFromDB(userId, (currentSgfContents, err) => {
        if (err !== null) {
            callback(null, false, err);
            return;
        }

        getBoardInfoViaDiskHandling(currentSgfContents, gnugoParser.playerUndoGetBoardInfoFromSgf, (boardInfo, err) => {
            if (err !== null) {
                callback(null, false, err);
                return;
            }

            // Don't write to DB if current game is already over, or new board is illegal.
            if (!isSgfGameOver(currentSgfContents) && !boardInfo.isBoardIllegal) {
                // NOTE: Undone moves are written successfully by gnugoExecutor, but they must be explicitly removed, or the moves will show up on the
                //       next write.
                const undoSuccessful = hasUndoneMoves(boardInfo.newSgfContents);
                if (undoSuccessful) {
                    boardInfo.newSgfContents = removeUndoneMovesFromSgf(boardInfo.newSgfContents);
                }

                writeAccountGameToDB(userId, boardInfo.newSgfContents, (data, err) => {
                    callback(boardInfo, undoSuccessful, err);
                });
            } else {
                callback(boardInfo, false, null);
            }
        });
    });
}

// callback(scoreInfo, err)
function getScoreInfo(userId, callback) {
    readAccountGameFromDB(userId, (currentSgfContents, err) => {
        if (err !== null) {
            callback(null, err);
            return;
        }

        getScoreInfoViaDiskHandling(currentSgfContents, (scoreInfo, err) => {
            callback(scoreInfo, err);
        });
    });
}

module.exports = module.exports = {
    'getCurrentBoardInfo': getCurrentBoardInfo,
    'placeStoneAddAIMove': placeStoneAddAIMove,
    'getScoreInfo': getScoreInfo,
    'undoMoves': undoMoves,
    'resetBoard': resetBoard,
    'playerResigns': playerResigns,
    'passAddAIMove': passAddAIMove,
};
