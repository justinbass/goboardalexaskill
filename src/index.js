const Alexa = require('ask-sdk-core');
const gameStateManager = require('./gameStateManager');
const config = require('./config');

// TODO: Move these constants to config
const ALEXA_APL_STRING = 'Alexa.Presentation.APL';
const RENDER_DOCUMENT_TOKEN = '6f90290f-7198-4feb-9961-780ad50b9197';
const APL_COMPONENT_ID = '47f69265-317b-4d9f-bed2-91d087f94972';
const IMAGES_URL_PATH = 'https://s3-us-west-2.amazonaws.com/goboardalexaskill-11xwy4cxlbnjiwe5moey/images/';

const ERROR_SPEECH = 'There was a problem with my response. Please try again';

function getAiColorName(color) {
    let aiColor = 0;
    if (color === 'black') {
        aiColor = 4;
    } else if (color === 'white') {
        aiColor = 3;
    }

    return aiColor;
}

function getPlayerColorName(color) {
    let myColor = 0;
    if (color === 'black') {
        myColor = 3;
    } else if (color === 'white') {
        myColor = 4;
    }

    return myColor;
}

// Mark the AI's last moves with a different color
function colorAILastMove(boardInfo) {
    // Don't set if the AI didn't make a move
    if (boardInfo.lastMoveCoordinates !== null && boardInfo.lastMoveCoordinates !== undefined && boardInfo.lastMoveCoordinates.length === 2) {
        const aiColor = getAiColorName(boardInfo.gameOptions.color);
        const aiMoveY = boardInfo.lastMoveCoordinates[0];
        const aiMoveX = boardInfo.lastMoveCoordinates[1];

        // Don't set if the AI's piece was captured. This shouldn't be possible, but check it anyways.
        if (boardInfo.currentBoardValues[aiMoveY][aiMoveX] !== 0) {
            boardInfo.currentBoardValues[aiMoveY][aiMoveX] = aiColor;
        }
    }
}

// Mark the Player's last moves with a different color
function colorPlayerLastMove(boardInfo, vCoord, hCoord) {
    // Don't set if the player's piece was captured
    if (boardInfo.currentBoardValues[boardInfo.gameOptions.boardSize-vCoord][hCoord] !== 0) {
        const playerColor = getPlayerColorName(boardInfo.gameOptions.color);
        boardInfo.currentBoardValues[boardInfo.gameOptions.boardSize-vCoord][hCoord] = playerColor;
    }
}

function getArticleFromPlayer(player) {
    if (player === 1) {
        return 'Black';
    } else if (player === 2) {
        return 'White';
    } else {
        return '';
    }
}

function getPointsText(score) {
    if (parseInt(score) === 1) {
        return '1 point';
    } else {
        return `${score} points`;
    }
}

// Take scoreInfo/gameResult and return the speech text for who won and how.
function getGameOverWinnerSpeechText(scoreInfo) {
    let speechText = `The game is over. ${getArticleFromPlayer(scoreInfo.winner)} won by `;

    if (scoreInfo.resigned) {
        speechText += 'resignation.';
    } else {
        speechText += `${getPointsText(scoreInfo.score)}.`;
    }

    return speechText;
}

function getHorizontalCoordinates(size) {
    horizontalCoordinates = [];

    for (let i = 0; i < size; i++) {
        const letter = String.fromCharCode('A'.charCodeAt(0) + i);
        horizontalCoordinates.push(letter);
    }

    return horizontalCoordinates;
}

function getVerticalCoordinates(size) {
    verticalCoordinates = [];

    for (let i = 0; i < size; i++) {
        verticalCoordinates.unshift((i + 1).toString());
    }

    return verticalCoordinates;
}

function isAPLSupported(requestEnvelope) {
    return requestEnvelope.context &&
        requestEnvelope.context.System &&
        requestEnvelope.context.System.device &&
        requestEnvelope.context.System.device.supportedInterfaces &&
        ALEXA_APL_STRING in requestEnvelope.context.System.device.supportedInterfaces;
}

function isGoBoardVisibleOnDevice(requestEnvelope) {
    return requestEnvelope.context &&
        requestEnvelope.context[ALEXA_APL_STRING] &&
        requestEnvelope.context[ALEXA_APL_STRING].componentsVisibleOnScreen &&
        requestEnvelope.context[ALEXA_APL_STRING].componentsVisibleOnScreen.some((component) => {
            return component.id && component.id.includes(APL_COMPONENT_ID) || component.children && component.children.some((children) => {
                return children.id.includes(APL_COMPONENT_ID);
            });
        });
}

function getUserId(requestEnvelope) {
    return requestEnvelope.context &&
        requestEnvelope.context.System &&
        requestEnvelope.context.System.user &&
        requestEnvelope.context.System.user.userId;
}

// Divide by the entire board (100) by size (grid + tiles hanging off) + 2 (coordinates) to get each tile width/height.
function getTileSize(boardSize) {
    return 100 / (parseInt(boardSize) + 2);
}

// Send a progressive response via Alexa Directive Service for long-running operations.
// TODO: Throws UnhandledPromiseRejectionWarning: ServiceError: Not Authorized.
function sendProgressiveResponse(handlerInput, speechText) {
    try {
        const requestEnvelope = handlerInput.requestEnvelope;
        const directiveServiceClient = handlerInput.serviceClientFactory.getDirectiveServiceClient();

        const requestId = requestEnvelope.request.requestId;
        const endpoint = requestEnvelope.context.System.apiEndpoint;
        const token = requestEnvelope.context.System.apiAccessToken;

        // build the progressive response directive
        const directive = {
            header: {
                requestId,
            },
            directive: {
                type: 'VoicePlayer.Speak',
                speech: speechText,
            },
        };

        // Send directive. Result not currently used.
        return directiveServiceClient.enqueue(directive, endpoint, token);
    } catch (err) {
        console.log('ERROR: Could not send progressive response.');
    }
}

// Transform the boardValues so that empty spaces are grids.
function transformBoardValues(boardValues) {
    const size = boardValues.length;
    const midIndex = parseInt(size / 2);
    const lastIndex = size - 1;
    const firstStarPoint = 3;
    const lastStarPoint = lastIndex - firstStarPoint;

    return boardValues.map((row, y) => {
        return row.map((value, x) => {
            if (value === 0) {
                if (x === 0 && y === 0) {
                    return 18; // Top left
                } else if (x === 0 && y === lastIndex) {
                    return 16; // Bottom left
                } else if (x === lastIndex && y === 0) {
                    return 12; // Top right
                } else if (x === lastIndex && y === lastIndex) {
                    return 14; // Bottom right
                } else if (x === 0) {
                    return 17; // Left
                } else if (y === 0) {
                    return 11; // Top
                } else if (x === lastIndex) {
                    return 13; // Right
                } else if (y === lastIndex) {
                    return 15; // Bottom
                } else if ((x === firstStarPoint && (y === firstStarPoint || y === midIndex || y === lastStarPoint)) ||
                           (x === midIndex && (y === firstStarPoint || y === midIndex || y === lastStarPoint)) ||
                           (x === lastStarPoint && (y === firstStarPoint || y === midIndex || y === lastStarPoint))) {
                    return 19; // Center with star point
                } else {
                    return 10; // Center
                }
            } else {
                return value;
            }
        });
    });
}

function getRenderDocumentDirective(boardInfo) {
    return {
        type: `${ALEXA_APL_STRING}.RenderDocument`,
        token: RENDER_DOCUMENT_TOKEN,
        version: '1.0',
        document: require('./main.json'),
        datasources:
        {
            'data': {
                'boardValues': transformBoardValues(boardInfo.currentBoardValues),
                'boardSize': boardInfo.gameOptions.boardSize,
                'tileWidth': getTileSize(boardInfo.gameOptions.boardSize),
                'tileHeight': getTileSize(boardInfo.gameOptions.boardSize),
                'imagesPath': IMAGES_URL_PATH,
                'horizontalCoordinates': getHorizontalCoordinates(boardInfo.gameOptions.boardSize),
                'verticalCoordinates': getVerticalCoordinates(boardInfo.gameOptions.boardSize),
            },
        },
    };
}

// This directive keeps the APL document open for the specified time on devices that otherwise close it automatically (Echo Show).
function getIdleDirective() {
    return {
        type: `${ALEXA_APL_STRING}.ExecuteCommands`,
        token: RENDER_DOCUMENT_TOKEN,
        commands: [{
            type: 'Idle',
            delay: config.MAX_DISPLAY_TIME_MILLISECONDS - config.DEFAULT_DISPLAY_TIME_MILLISECONDS,
        }],
    };
}

function buildSpeechResponse(handlerInput, speechText) {
    if (isAPLSupported(handlerInput.requestEnvelope)) {
        return handlerInput.responseBuilder
            .speak(speechText)
            .addDirective(getIdleDirective())
            .getResponse();
    } else {
        return handlerInput.responseBuilder
            .speak(speechText)
            .getResponse();
    }
}

function buildCommonResponse(handlerInput, speechText, boardInfo) {
    if (isAPLSupported(handlerInput.requestEnvelope)) {
        const renderDocumentDirective = getRenderDocumentDirective(boardInfo);

        return handlerInput.responseBuilder
            .speak(speechText)
            .addDirective(renderDocumentDirective)
            .addDirective(getIdleDirective())
            .getResponse();
    } else {
        return buildSpeechResponse(handlerInput, speechText);
    }
}

// Return a Promise that shows the saved Go Board state, unless it's already visible on the screen.
function getShowBoardPromise(handlerInput, speechText) {
    if (isGoBoardVisibleOnDevice(handlerInput.requestEnvelope)) {
        return buildSpeechResponse(handlerInput, speechText);
    }

    return new Promise((resolve) => {
        const userId = getUserId(handlerInput.requestEnvelope);
        gameStateManager.getCurrentBoardInfo(userId, (boardInfo, err) => {
            if (err !== null) {
                resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
            } else {
                resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
            }
        });
    });
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    handle(handlerInput) {
        let speechText = 'Welcome to Go Board. Ask for help at any time to learn how to play.';
        if (!isAPLSupported(handlerInput.requestEnvelope)) {
            speechText += ' No supported display is detected, continuing in voice only mode.';
        }

        // Always reshow the board on launch, even if the board looks displayed. Just in case of any unexpected issue. This occurs in the development
        // environment, where the board doesn't show on launch.
        return new Promise((resolve) => {
            const userId = getUserId(handlerInput.requestEnvelope);
            gameStateManager.getCurrentBoardInfo(userId, (boardInfo, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                } else {
                    resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                }
            });
        });
    },
};

const StartGameIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'StartGameIntent'
            && handlerInput.requestEnvelope.request.intent.confirmationStatus === 'CONFIRMED';
    },
    handle(handlerInput) {
        const speechText = 'Starting a new game.';

        return new Promise((resolve) => {
            const userId = getUserId(handlerInput.requestEnvelope);
            gameStateManager.resetBoard(userId, null, (boardInfo, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                } else {
                    resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                }
            });
        });
    },
};

const PlaceStoneIntentHandler = {
    canHandle(handlerInput) {
        // Check verticalCoordinateNumber < 100, since GnugoExecutor doesn't handle 3+ digit numbers.
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'PlaceStoneIntent'
            && handlerInput.requestEnvelope.request.intent.slots !== undefined
            && handlerInput.requestEnvelope.request.intent.slots.horizontalCoordinateLetter.value !== undefined
            && handlerInput.requestEnvelope.request.intent.slots.verticalCoordinateNumber.value !== undefined
            && !isNaN(handlerInput.requestEnvelope.request.intent.slots.verticalCoordinateNumber.value)
            && parseInt(handlerInput.requestEnvelope.request.intent.slots.verticalCoordinateNumber.value) < 100
            && parseInt(handlerInput.requestEnvelope.request.intent.slots.verticalCoordinateNumber.value) > 0;
    },
    handle(handlerInput) {
        return new Promise((resolve) => {
            const userId = getUserId(handlerInput.requestEnvelope);

            const slots = handlerInput.requestEnvelope.request.intent.slots;

            const hCoordLetter = slots.horizontalCoordinateLetter.value.toUpperCase()[0];
            const hCoord = hCoordLetter.charCodeAt(0) - 'A'.charCodeAt(0);
            const vCoord = parseInt(slots.verticalCoordinateNumber.value);

            // NOTE: This will be sanitized later in the flow.
            const move = `${hCoordLetter}${vCoord}`;

            sendProgressiveResponse(handlerInput, `I heard ${move}.`);

            // TODO: Use gameAlreadyOver?
            gameStateManager.placeStoneAddAIMove(userId, move, (boardInfo, gameAlreadyOver, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                    return;
                }

                if (boardInfo.currentGameResult !== null) {
                    resolve(buildSpeechResponse(handlerInput, getGameOverWinnerSpeechText(boardInfo.currentGameResult)));

                // BoardInfo.isBoardIllegal apparently doesn't account for all moves off the board. Check them manually just in case.
                } else if (
                    boardInfo.isBoardIllegal ||
                    vCoord < 0 ||
                    hCoord < 0 ||
                    vCoord > boardInfo.gameOptions.boardSize ||
                    hCoord > boardInfo.gameOptions.boardSize) {
                    const speechText = `You cannot place at ${hCoordLetter} ${vCoord}. Try again.`;

                    resolve(buildSpeechResponse(handlerInput, speechText));

                // Assuming game is not over and move is valid
                } else {
                    // Set the new board as the current board - required to display
                    boardInfo.currentBoardValues = boardInfo.newBoardValues;

                    colorPlayerLastMove(boardInfo, vCoord, hCoord);

                    let speechText = `You placed at ${hCoordLetter} ${vCoord}. `;

                    // TODO: Implement isLastMovePass, isLastMoveResign pass? Don't use lastMoveString. Clean this all up.
                    if (boardInfo.lastMoveString === 'RESIGN' || (boardInfo.newGameResult !== null && boardInfo.newGameResult.resigned)) {
                        speechText += 'I resigned. You win the game.';
                    } else if (boardInfo.lastMoveString === 'PASS') {
                        speechText += 'I passed. If you pass too, the game will end.';
                    } else {
                        speechText += `I placed at ${boardInfo.lastMoveString}.`;

                        // NOTE: Use this for testing with two Alexa devices.
                        // speechText += ` Alexa. <break time="0.15s"/> Place at`;
                        // speechText += ` ${config.NATO_ALPHABET[boardInfo.lastMoveString.slice(0,1)]} <break time="0.03s"/>`;
                        // speechText += ` ${boardInfo.lastMoveString.slice(1,4)}.`;

                        colorAILastMove(boardInfo);
                    }

                    resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                }
            });
        });
    },
};

const PassIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'PassIntent'
            && handlerInput.requestEnvelope.request.intent.confirmationStatus === 'CONFIRMED';
    },
    handle(handlerInput) {
        return new Promise((resolve) => {
            const userId = getUserId(handlerInput.requestEnvelope);

            // TODO: Remove gameAlreadyOver? We can use current/new game result for this.
            gameStateManager.passAddAIMove(userId, (boardInfo, gameAlreadyOver, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                    return;
                }

                if (gameAlreadyOver) {
                    resolve(buildSpeechResponse(handlerInput, getGameOverWinnerSpeechText(boardInfo.currentGameResult)));
                } else {
                    let speechText = 'You passed. ';

                    // TODO: Implement isLastMovePass, isLastMoveResign pass? Don't use lastMoveString. Clean this all up.
                    if (boardInfo.lastMoveString === 'RESIGN' || (boardInfo.newGameResult !== null && boardInfo.newGameResult.resigned)) {
                        speechText += 'I resigned. You win the game.';
                    } else if (boardInfo.lastMoveString === 'PASS') {
                        speechText += 'I passed too. Two passes ends the game. ';

                        if (boardInfo.newGameResult !== null) {
                            speechText += `${getArticleFromPlayer(boardInfo.newGameResult.winner)}`;
                            speechText += ` won by ${getPointsText(boardInfo.newGameResult.score)}.`;
                        }

                    // This is the case where the AI passed previously, and didn't pass this time.
                    // TODO: This edge case is invalid if it occurs, as it may add a post-game-end move to the board.
                    //       We won't set newBoard to currentBoard, and the game ends, but the invalid SGF will be saved.
                    } else if (boardInfo.newGameResult !== null) {
                        speechText += `Two passes ends the game. ${getArticleFromPlayer(boardInfo.newGameResult.winner)}`;
                        speechText += ` won by ${getPointsText(boardInfo.newGameResult.score)}.`;
                    } else {
                        speechText += `I placed at ${boardInfo.lastMoveString}.`;

                        // Need to set the next move as the current, for display purposes (only if the AI didn't pass).
                        boardInfo.currentBoardValues = boardInfo.newBoardValues;
                        colorAILastMove(boardInfo);
                    }

                    resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                }
            });
        });
    },
};

const ResignIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'ResignIntent'
            && handlerInput.requestEnvelope.request.intent.confirmationStatus === 'CONFIRMED';
    },
    handle(handlerInput) {
        return new Promise((resolve) => {
            const userId = getUserId(handlerInput.requestEnvelope);

            // TODO: Remove alreadyResigned? We can use current/new game result for this.
            gameStateManager.playerResigns(userId, (boardInfo, alreadyResigned, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                    return;
                }

                let speechText;

                if (alreadyResigned) {
                    speechText = getGameOverWinnerSpeechText(boardInfo.currentGameResult);
                } else {
                    speechText = `You resigned. I win the game.`;
                }

                if (isGoBoardVisibleOnDevice(handlerInput.requestEnvelope)) {
                    resolve(buildSpeechResponse(handlerInput, speechText));
                } else {
                    resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                }
            });
        });
    },
};

const ScoreIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'ScoreIntent';
    },
    handle(handlerInput) {
        return new Promise((resolve) => {
            sendProgressiveResponse(handlerInput, 'Let me get the score.');

            const userId = getUserId(handlerInput.requestEnvelope);

            gameStateManager.getScoreInfo(userId, (scoreInfo, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                    return;
                }

                let speechText;

                if (scoreInfo.isGameOver) {
                    speechText = getGameOverWinnerSpeechText(scoreInfo);
                } else {
                    speechText = `I predict that ${getArticleFromPlayer(scoreInfo.winner)} will win by ${getPointsText(scoreInfo.score)}.`;
                }

                resolve(buildSpeechResponse(handlerInput, speechText));
            });
        });
    },
};

const UndoIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'UndoIntent';
    },
    handle(handlerInput) {
        return new Promise((resolve) => {
            const userId = getUserId(handlerInput.requestEnvelope);

            // TODO: Remove undoSuccessful? We can use current/new game result for this.
            gameStateManager.undoMoves(userId, (boardInfo, undoSuccessful, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                    return;
                }

                if (boardInfo.currentGameResult !== null) {
                    resolve(buildSpeechResponse(handlerInput, getGameOverWinnerSpeechText(boardInfo.currentGameResult)));
                } else {
                    let speechText;

                    if (undoSuccessful) {
                        speechText = 'The last two moves were undone';
                    } else {
                        speechText = 'Cannot undo. There is no previous position.';
                    }

                    // Set the new board as the current board - required to display
                    boardInfo.currentBoardValues = boardInfo.newBoardValues;

                    resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                }
            });
        });
    },
};

function getConfigurationChangeHandler(intentName, configurationName, validList, spokenName, slotModifierFunction = null) {
    return {
        canHandle(handlerInput) {
            return handlerInput.requestEnvelope.request.type === 'IntentRequest'
                && handlerInput.requestEnvelope.request.intent.name === intentName
                && handlerInput.requestEnvelope.request.intent.confirmationStatus === 'CONFIRMED';
        },
        handle(handlerInput) {
            const slots = handlerInput.requestEnvelope.request.intent.slots;
            let newConfigValue = slots[configurationName].value;

            // For changing rules and color
            if (isNaN(newConfigValue)) {
                newConfigValue = newConfigValue.toLowerCase();
            }

            // TODO: Check this in a different handler/filter in can handle, e.g. don't ask for confirmation in this handler if the size is invalid.
            if (validList.includes(newConfigValue)) {
                // For adding 0.5 to compensation, after validation succeeds.
                if (slotModifierFunction !== null) {
                    newConfigValue = slotModifierFunction(newConfigValue);
                }

                return new Promise((resolve) => {
                    const userId = getUserId(handlerInput.requestEnvelope);

                    const newGameOptions = {};
                    newGameOptions[configurationName] = newConfigValue;

                    gameStateManager.resetBoard(userId, newGameOptions, (boardInfo, err) => {
                        if (err !== null) {
                            resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                        } else {
                            const speechText = `Changing ${spokenName} to ${newConfigValue}, starting a new game.`;

                            resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                        }
                    });
                });
            } else {
                const speechText = `That value for ${spokenName} is not supported. Try one of the following: ${validList.join(', ')}.`;

                return getShowBoardPromise(handlerInput, speechText);
            }
        },
    };
}

const ChangeBoardSizeIntentHandler = getConfigurationChangeHandler('ChangeBoardSizeIntent', 'boardSize', config.VALID_BOARD_SIZES, 'the board size');

const ChangeHandicapIntentHandler = getConfigurationChangeHandler('ChangeHandicapIntent', 'handicap', config.VALID_HANDICAPS, `black's handicap`);

const ChangeLevelIntentHandler = getConfigurationChangeHandler('ChangeLevelIntent', 'level', config.VALID_LEVELS, 'my level');

const ChangeRulesHandler = getConfigurationChangeHandler('ChangeRulesIntent', 'rules', config.VALID_RULES, 'the rules');

const ChangeColorHandler = getConfigurationChangeHandler('ChangeColorIntent', 'color', config.VALID_COLORS, 'your color');

const ChangeCompensationHandler = getConfigurationChangeHandler(
    'ChangeCompensationIntent',
    'komi',
    config.VALID_KOMIS,
    `white's compensation`,
    (compensation) => {
        if (isNaN(compensation)) {
            return null;
        } else {
            // Add 0.5 to user's desired compensation, to make it easier for them to say.
            return parseInt(compensation) + 0.5;
        }
    }
);

// TODO: Show a card temporarily so that rules are visible.
const HelpIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speechText = 'You can say, place B 2. undo. score. pass. resign. new game. configuration. or rules.';

        return getShowBoardPromise(handlerInput, speechText);
    },
};

// TODO: Show a card temporarily so that rules are visible.
const ConfigurationIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'ConfigurationIntent';
    },
    handle(handlerInput) {
        return new Promise((resolve) => {
            const userId = getUserId(handlerInput.requestEnvelope);
            gameStateManager.getCurrentBoardInfo(userId, (boardInfo, err) => {
                if (err !== null) {
                    resolve(buildSpeechResponse(handlerInput, ERROR_SPEECH));
                } else {
                    let speechText = `Your board size is ${boardInfo.gameOptions.boardSize}, `;
                    speechText += `with a handicap of ${boardInfo.gameOptions.handicap} `;
                    speechText += `and white compensation of ${getPointsText(boardInfo.gameOptions.komi)}. `;
                    speechText += `${boardInfo.gameOptions.rules} rules are used for scoring. `;
                    speechText += `I am level ${boardInfo.gameOptions.level}, `;
                    speechText += `and you are playing ${boardInfo.gameOptions.color}. `;
                    speechText += `To learn how to change these, ask me for configuration help.`;

                    resolve(buildCommonResponse(handlerInput, speechText, boardInfo));
                }
            });
        });
    },
};

// TODO: Show a card temporarily so that rules are visible.
const ConfigurationHelpIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'ConfigurationHelpIntent';
    },
    handle(handlerInput) {
        const speechText = 'To change the configuration, you can say, size 13. handicap 5. level 6. compensation 0. color white. or japanese rules.';

        return getShowBoardPromise(handlerInput, speechText);
    },
};

const RuleIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'RuleIntent';
    },
    handle(handlerInput) {
        let speechText = 'Here are the simplified rules of Go. ';
        speechText += 'Two players take turns placing black and white tiles. ';
        speechText += 'Adjacent tiles form a group. ';
        speechText += 'Capture an empty space or the other player\'s groups by completely surrounding it. ';
        speechText += 'Resign or pass twice to end the game. ';
        speechText += 'For more information, read the description of this skill. Most importantly, have fun!';

        return getShowBoardPromise(handlerInput, speechText);
    },
};

const NotConfirmedIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && (handlerInput.requestEnvelope.request.intent.name === 'StartGameIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'ResignIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'ChangeBoardSizeIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'ChangeHandicapIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'ChangeLevelIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'ChangeRulesIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'ChangeColorIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'ChangeCompensationIntent' ||
                handlerInput.requestEnvelope.request.intent.name === 'PassIntent')
            && handlerInput.requestEnvelope.request.intent.confirmationStatus !== 'CONFIRMED';
    },
    handle(handlerInput) {
        const speechText = 'Continuing this game.';

        return getShowBoardPromise(handlerInput, speechText);
    },
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
                || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speechText = 'Goodbye!';

        return handlerInput.responseBuilder
            .speak(speechText)
            .withShouldEndSession(true)
            .getResponse();
    },
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .getResponse();
    },
};

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Error handled: ${error.message}`);
        const speechText = 'Sorry, I couldn\'t understand what you said. Please try again.';

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText) // Keeps session open for the user to speak again
            .getResponse();
    },
};

// This handler acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        PassIntentHandler,
        PlaceStoneIntentHandler,
        StartGameIntentHandler,
        ChangeBoardSizeIntentHandler,
        ChangeHandicapIntentHandler,
        ChangeLevelIntentHandler,
        ChangeRulesHandler,
        ChangeColorHandler,
        ChangeCompensationHandler,
        HelpIntentHandler,
        ConfigurationIntentHandler,
        ConfigurationHelpIntentHandler,
        ResignIntentHandler,
        RuleIntentHandler,
        ScoreIntentHandler,
        SessionEndedRequestHandler,
        UndoIntentHandler,
        NotConfirmedIntentHandler,
        CancelAndStopIntentHandler
    )
    .addErrorHandlers(
        ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();
