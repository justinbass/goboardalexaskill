const AWS = require('aws-sdk');
const assert = require('assert');
const lambdaLocal = require('lambda-local');

const TESTING_SIZE = '9';
const TESTING_HANDICAP = '0';
const TESTING_LEVEL = '1';
const TESTING_COMPENSATION = '6';
const TESTING_RULES = 'Chinese';

const MY_USER_ID = 'amzn1.ask.account.AG7CFXLWMELLLEXHX7JIA62CXJHIDVA4CZP4WDY7KYSPHV5IEF3WSF7U7FVN2I4KWSLFIY2CVWGID5X' +
                   'DKNMT3AWBCNWSZ57S4JN3UHZDXS5CAESINMST556M7DFS6MMCC5NFGNXSXELEBKOMCEB73O2AMILYYCHNSFDGI4OV7SIKNCYO' +
                   'IP3GYMJGRJ56PIK4FUSCWYJLRYSP5QY';


function getInitialPromise() {
    return new Promise((resolve) => {
        resolve();
    });
}

/**
 * Execute an Alexa request via LamdaLocal, and return a few specific values from the response for testing.
 * This function accepts a JsonPayload, to allow loading from file and then modifying it before requesting.
 *
 * @param {Object} jsonPayload Json payload for the associated Alexa request.
 * @return {Promise} Promise(function(speechText, boardValues)). SpeechText is a String representing the Alexa
                     speech response, and BoardValues is a double-nested Array of ints representing the resulting board
                     tiles.
 */
function executeRequestJsonPayload(jsonPayload) {
    return new Promise((resolve) => {
        lambdaLocal.execute({
            event: jsonPayload,
            lambdaPath: '../src/index.js',
            profilePath: '~/.aws/credentials',
            profileName: 'default',
            timeoutMs: 10000,
            verboseLevel: 0,
        }).then(function(done) {
            let speechText = done.response.outputSpeech.ssml;
            speechText = speechText.replace('<speak>', '');
            speechText = speechText.replace('</speak>', '');

            let boardValues = null;
            if (done &&
                done.response &&
                done.response.directives &&
                done.response.directives[0] &&
                done.response.directives[0].datasources &&
                done.response.directives[0].datasources.data &&
                done.response.directives[0].datasources.data.boardValues) {
                boardValues = done.response.directives[0].datasources.data.boardValues;
                boardValues = boardValues.map(function(row) {
                    return row.map(function(value) {
                        if (value === 0 || value >= 10) {
                            return ' ';
                        }

                        return value.toString();
                    }).join('');
                });
            }

            // NOTE: Speech response should never include this for the current E2E tests.
            assert(!speechText.includes('There was a problem with my response.'));

            resolve([speechText, boardValues]);
        }).catch(function(err) {
            console.log(err);

            resolve(null, null);
        });
    });
}

/**
 * Execute an Alexa request via LamdaLocal, and return a few specific values from the response for testing.
 * Use this function to execute a request that doesn't need payload modification first.
 * TODO: Refactor into executeRequestJsonPayload, with modifying function
 *
 * @param {Object} jsonPayloadFilename Json payload filename, which will be loaded from disk.
 * @return {Promise} Promise(function(speechText, boardValues))
 */
function executeRequest(jsonPayloadFilename) {
    jsonPayloadFilename = './requests/' + jsonPayloadFilename;
    const jsonPayload = require(jsonPayloadFilename);
    return executeRequestJsonPayload(jsonPayload);
}

/**
 * Get a promise that performs a launch request as a sanity, then gets a new game. To be used before tests.
 *
 * @return {Promise} Promise(function(speechText, boardValues))
 */
function getNewgamePromise() {
    return executeRequest('launchRequest.json').then(([speechText, boardValues]) => {
        console.log(speechText);
    }).then(() => executeRequest('newgameRequest.json')).then(([speechText, boardValues]) => {
        console.log(speechText);
    });
}

/**
 * Get a promise that performs a get-score request, then a launch request. Use functions from tests to perform
 * assertions on speechText and boardValues.
 *
 * @param {Promise} promise An input promise, for which to perform this logic inside promise.then()
 * @param {Function} scoreAssertFunction A function accepting speechText, which can perform assertions.
 * @param {Function} boardValuesAssertFunction A function accepting boardValues, which can perform assertions.
 * @return {Promise} Promise()
 */
function getScoreLaunchPromiseAndAssert(promise, scoreAssertFunction = null, boardValuesAssertFunction = null) {
    return promise.then(() => executeRequest('scoreRequest.json')).then(([scoreSpeechText, boardValues]) => {
        return scoreSpeechText;
    }).then((scoreSpeechText) => {
        console.log(`Score speech text: ${scoreSpeechText}`);

        if (scoreAssertFunction !== null) {
            scoreAssertFunction(scoreSpeechText);
        }

        return executeRequest('launchRequest.json');
    }).then(([scoreSpeechText, boardValues]) => {
        console.log(boardValues);

        if (boardValuesAssertFunction !== null) {
            const emptyCount = boardValues.join('').split(' ').length - 1;
            const blackCount = boardValues.join('').split('1').length + boardValues.join('').split('3').length - 2;
            const whiteCount = boardValues.join('').split('2').length + boardValues.join('').split('4').length - 2;
            boardValuesAssertFunction(emptyCount, blackCount, whiteCount);
        }
    });
}

function addRequestPromise(promise, jsonPayloadFilename, times, speechTextAssertionFunction = null, modifyPayloadFunction = null) {
    jsonPayloadFilename = './requests/' + jsonPayloadFilename;
    const jsonPayload = require(jsonPayloadFilename);

    // Cannot use i below, which is already at times inside the promise function body.
    let currentIteration = 0;

    for (let i = 0; i < times; i++) {
        promise = promise.then(() => {
            if (modifyPayloadFunction !== null) {
                modifyPayloadFunction(jsonPayload);
            }

            return executeRequestJsonPayload(jsonPayload);
        }).then(([speechText, boardValues]) => {
            currentIteration += 1;
            console.log(`Iteration ${currentIteration}/${times}: ${speechText}`);

            if (speechTextAssertionFunction !== null) {
                speechTextAssertionFunction(speechText);
            }
        });
    }

    return promise;
}

function addRandomMoves(promise, times, size) {
    return addRequestPromise(promise, 'moveRequest.json', times, null, (jsonPayload) => {
        const randomLetter = String.fromCharCode('a'.charCodeAt(0) + Math.floor(Math.random() * size));
        const randomNumber = (Math.floor(Math.random() * size) + 1).toString();
        jsonPayload.request.intent.slots.horizontalCoordinateLetter.value = randomLetter;
        jsonPayload.request.intent.slots.verticalCoordinateNumber.value = randomNumber;
    });
}

function changeColor(promise, color) {
    promise = addRequestPromise(promise, 'colorRequest.json', 1, (speechText) => {
        assert(speechText.trim().includes(`Changing your color to ${color}`));
    }, (jsonPayload) => {
        jsonPayload.request.intent.slots.color.value = color;
    });

    promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
        assert(speechText.trim().includes(`you are playing ${color}`));
    });

    return promise;
}

// Use this to assert the winner is the other player. Empirically, random moves consistently lose against a level 1 AI.
function otherColorCamelcase(color) {
    if (color === 'white') {
        return 'Black';
    } else if (color === 'black') {
        return 'White';
    }
}

function colorCamelcase(color) {
    if (color === 'white') {
        return 'White';
    } else if (color === 'black') {
        return 'Black';
    }
}

// TODO: Use this before each test.
// function deleteAccountGameInDB(userId, callback) {
//     AWS.config.update({region:'us-west-2'});
//     let ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
//
//     let params = {
//         TableName: 'GoGameAlexaSkillGames',
//         Key: {
//             'accountId' : {S: userId},
//         }
//     };
//
//     // Call DynamoDB to add the item to the table
//     ddb.deleteItem(params, function(err, data) {
//         if (err) {
//             console.log('Error', err);
//         }
//
//         callback(data);
//     });
// }

function writeAccountGameToDB(userId, sgfGame, callback) {
    AWS.config.update({region: 'us-west-2'});
    const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

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
            console.log('Error', err);
        }

        assert(err === null);

        callback(err);
    });
}

function testsMovesBothColors(executeMovesLogic) {
    const colors = ['black', 'white'];

    let promise = getInitialPromise();
    colors.forEach((color) => {
        promise = promise.then(() => {
            let innerPromise = getNewgamePromise();
            innerPromise = changeColor(innerPromise, color);
            innerPromise = executeMovesLogic(innerPromise, color);
            return innerPromise;
        });
    });

    return promise;
}

// Actual tests

describe('Get Help', function() {
    it('Should return correct static help speech text.', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'helpRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('You can say'));
        });

        return promise;
    });
});

describe('Get Rules', function() {
    it('Should return correct static rules speech text.', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'rulesRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Here are the simplified rules of Go. '));
        });

        return promise;
    });
});

describe('Get Configuration Help', function() {
    it('Should return correct static configuration help speech text.', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'configurationHelpRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('To change the configuration, you can say, '));
        });

        return promise;
    });
});


describe('Change size', function() {
    it('Should correctly change board size, based on speech text response', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'changeSizeRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Changing the board size to 17'));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.boardSize.value = '17';
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Your board size is 17'));
        });

        promise = addRequestPromise(promise, 'changeSizeRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`Changing the board size to ${TESTING_SIZE}`));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.boardSize.value = TESTING_SIZE;
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`Your board size is ${TESTING_SIZE}`));
        });

        return promise;
    });
});

describe('Change handicap', function() {
    it('Should correctly change handicap, based on speech text response', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'handicapRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Changing black\'s handicap to 9'));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.handicap.value = '9';
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('with a handicap of 9'));
        });

        promise = addRequestPromise(promise, 'handicapRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`Changing black's handicap to ${TESTING_HANDICAP}`));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.handicap.value = TESTING_HANDICAP;
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`with a handicap of ${TESTING_HANDICAP}`));
        });

        return promise;
    });
});

describe('Change level', function() {
    it('Should correctly change level, based on speech text response', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'levelRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Changing my level to 6'));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.level.value = '6';
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('I am level 6'));
        });

        promise = addRequestPromise(promise, 'levelRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`Changing my level to ${TESTING_LEVEL}`));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.level.value = TESTING_LEVEL;
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`I am level ${TESTING_LEVEL}`));
        });

        return promise;
    });
});

describe('Change compensation', function() {
    it('Should correctly change compensation, based on speech text response', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'compensationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Changing white\'s compensation to 0.5'));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.komi.value = '0';
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('white compensation of 0.5 points'));
        });

        promise = addRequestPromise(promise, 'compensationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`Changing white's compensation to ${parseInt(TESTING_COMPENSATION) + 0.5}`));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.komi.value = TESTING_COMPENSATION;
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`white compensation of ${parseInt(TESTING_COMPENSATION) + 0.5} points`));
        });

        return promise;
    });
});

describe('Change rules', function() {
    it('Should correctly change rules, based on speech text response', function() {
        let promise = getNewgamePromise();

        promise = addRequestPromise(promise, 'changeRulesRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Changing the rules to japanese'));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.rules.value = 'Japanese';
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes('Japanese rules are used for scoring'));
        });

        promise = addRequestPromise(promise, 'changeRulesRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`Changing the rules to ${TESTING_RULES.toLowerCase()}`));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.rules.value = TESTING_RULES;
        });

        promise = addRequestPromise(promise, 'configurationRequest.json', 1, (speechText) => {
            assert(speechText.trim().includes(`${TESTING_RULES} rules are used for scoring`));
        });

        return promise;
    });
});

describe('Moves then resign', function() {
    it('Player makes a few moves and then resigns.', function() {
        return testsMovesBothColors((promise, color) => {
            promise = addRandomMoves(promise, 5, TESTING_SIZE);
            promise = addRequestPromise(promise, 'resignRequest.json', 1);
            promise = addRandomMoves(promise, 5, TESTING_SIZE);
            promise = getScoreLaunchPromiseAndAssert(promise, (speechText) => {
                assert(speechText.trim() === `The game is over. ${otherColorCamelcase(color)} won by resignation.`);
            }, (emptyCount, blackCount, whiteCount) => {
                if (color === 'black') {
                    assert(emptyCount >= TESTING_SIZE * TESTING_SIZE - 10);
                    assert(blackCount <= 5);
                    assert(whiteCount <= 5);
                } else if (color === 'white') {
                    assert(emptyCount >= TESTING_SIZE * TESTING_SIZE - 11);
                    assert(blackCount <= 6);
                    assert(whiteCount <= 5);
                }
            });

            return promise;
        });
    });
});

describe('Pass to end', function() {
    it('Player only passes, causing AI to pass second, ending the game. AI will always win.', function() {
        return testsMovesBothColors((promise, color) => {
            promise = addRequestPromise(promise, 'passRequest.json', 15);
            promise = getScoreLaunchPromiseAndAssert(promise, (speechText) => {
                assert(speechText.trim().includes(`The game is over. ${otherColorCamelcase(color)} won by `));
                assert(speechText.trim().includes(' points.'));
            }, (emptyCount, blackCount, whiteCount) => {
                assert(emptyCount > TESTING_SIZE * TESTING_SIZE / 2);
                if (color === 'black') {
                    assert.equal(blackCount, 0);
                    assert(whiteCount > 3 && whiteCount < TESTING_SIZE * TESTING_SIZE / 2);
                } else {
                    assert(blackCount > 3 && whiteCount < TESTING_SIZE * TESTING_SIZE / 2);
                    assert.equal(whiteCount, 0);
                }
            });

            return promise;
        });
    });
});

describe('Undo at start', function() {
    it('Undo before making any moves', function() {
        return testsMovesBothColors((promise, color) => {
            promise = addRequestPromise(promise, 'undoRequest.json', 5);
            promise = getScoreLaunchPromiseAndAssert(promise, (speechText) => {
                // TODO: We cannot predict the color winner? Maybe this is ok, since it's early in the game.
                assert(speechText.trim().includes(`I predict that `));
                assert(speechText.trim().includes(' point'));
            }, (emptyCount, blackCount, whiteCount) => {
                assert(emptyCount > TESTING_SIZE * TESTING_SIZE / 2);
                assert.equal(whiteCount, 0);

                if (color === 'black') {
                    assert.equal(blackCount, 0);
                } else {
                    assert.equal(blackCount, 1);
                }
            });

            return promise;
        });
    });
});

describe('Undo after moves', function() {
    it('Make a few moves and undo them.', function() {
        return testsMovesBothColors((promise, color) => {
            promise = addRandomMoves(promise, 10, TESTING_SIZE);
            promise = addRequestPromise(promise, 'undoRequest.json', 5);
            promise = getScoreLaunchPromiseAndAssert(promise, (speechText) => {
                assert(speechText.trim().includes(`I predict that ${otherColorCamelcase(color)} will win by `));
                assert(speechText.trim().includes(' point'));
            }, (emptyCount, blackCount, whiteCount) => {
                assert(emptyCount > TESTING_SIZE * TESTING_SIZE / 2);
                assert(blackCount <= 6);
                assert(whiteCount <= 6);
            });

            return promise;
        });
    });
});

describe('Invalid move', function() {
    it('Make and invalid off-board move', function() {
        const promise = getNewgamePromise();

        return addRequestPromise(promise, 'moveRequest.json', 1, (speechText) => {
            assert(speechText.includes('Sorry, I couldn\'t understand what you said.'));
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.horizontalCoordinateLetter.value = 'a';
            jsonPayload.request.intent.slots.verticalCoordinateNumber.value = '100';
        });
    });
});


describe('Random moves to double-pass', function() {
    it('Make hundreds of random moves to simulate a full game. AI will virtually always win, passing first to end.', function() {
        return testsMovesBothColors((promise, color) => {
            promise = addRandomMoves(promise, 110, TESTING_SIZE);
            promise = addRequestPromise(promise, 'passRequest.json', 10);
            promise = getScoreLaunchPromiseAndAssert(promise, (speechText) => {
                assert(speechText.trim().includes(`The game is over. ${otherColorCamelcase(color)} won by `));
                assert(speechText.trim().includes(' points.'));
            }, (emptyCount, blackCount, whiteCount) => {
                assert(emptyCount < TESTING_SIZE * TESTING_SIZE / 2);
                assert(blackCount > TESTING_SIZE * TESTING_SIZE / 8);
                assert(whiteCount > TESTING_SIZE * TESTING_SIZE / 8);
            });

            return promise;
        });
    });
});

// Tests that write the the DB. Perform them after the others, to avoid needing to change the initial configuration every time.

// TODO: Make this more difficult
describe('Check timeout', function() {
    it('Write a difficult computation problem for the AI', function() {
        function writeTimeoutSgf() {
            return new Promise((resolve) => {
                const timeoutSgf = '(;GM[1]FF[4]SZ[17]GN[GNU Go 3.8 Random Seed 1557726730 level 6]DT[2019-05-13]C[VERSION="1.0" MODE="AI"' +
                                 'COLOR="white"]KM[6.5]HA[0]RU[Chinese]AP[GNU Go:3.8];B[od];W[mc];B[ne];W[kd];B[nc];W[md];B[co];W[dd];B[fd];W[df]' +
                                 ';B[dc];W[cc];B[ec];W[cb];B[no];W[cj];B[jn];W[lg];B[om];W[hc];B[ff];W[dn];B[do];W[en];B[bm];W[nd];B[oc];W[mi]' +
                                 ';B[ie];W[id];B[fp])';

                writeAccountGameToDB(MY_USER_ID, timeoutSgf, () => {
                    resolve();
                });
            });
        }

        let promise = writeTimeoutSgf();

        promise = addRequestPromise(promise, 'moveRequest.json', 1, (speechText) => {
        }, (jsonPayload) => {
            jsonPayload.request.intent.slots.horizontalCoordinateLetter.value = 'h';
            jsonPayload.request.intent.slots.verticalCoordinateNumber.value = '13';
        });

        promise = getScoreLaunchPromiseAndAssert(promise, (speechText) => {
        }, (boardValues) => {
        });

        return promise;
    });
});

describe('AI Resigns', function() {
    it('Force the AI to resign immediately by pre-filling the board with your moves.', function() {
        function writeResignSgf(color) {
            return new Promise((resolve) => {
                let aiResignSgf = `(;GM[1]FF[4]SZ[${TESTING_SIZE}]GN[GNU Go 3.8 Random Seed 1557642030 level 1]DT[2019-05-12]C[VERSION="1.0"` +
                                  `MODE="AI" COLOR="${color}"]KM[6.5]HA[0]RU[Chinese]AP[GNU Go:3.8]`;
                for (let y = 0; y < parseInt(TESTING_SIZE); y++) {
                    for (let x = 0; x < parseInt(TESTING_SIZE); x++) {
                        // Make two eyes.
                        if (x === 0 && y === 0 || x === 0 && y === 2) {
                            continue;
                        }

                        const yLetter = String.fromCharCode('a'.charCodeAt(0) + y);
                        const xLetter = String.fromCharCode('a'.charCodeAt(0) + x);

                        if (color === 'black') {
                            aiResignSgf += `;B[${yLetter}${xLetter}];W[]`;
                        } else if (color === 'white') {
                            aiResignSgf += `;W[${yLetter}${xLetter}];B[]`;
                        }
                    }
                }
                aiResignSgf += ')';

                writeAccountGameToDB(MY_USER_ID, aiResignSgf, (err) => {
                    resolve();
                });
            });
        }

        return testsMovesBothColors((promise, color) => {
            return promise.then(() => {
                let promise = writeResignSgf(color);
                promise = addRequestPromise(promise, 'passRequest.json', 1);
                promise = getScoreLaunchPromiseAndAssert(promise, (speechText) => {
                    assert.equal(speechText.trim(), `The game is over. ${colorCamelcase(color)} won by resignation.`);
                }, (emptyCount, blackCount, whiteCount) => {
                    assert.equal(emptyCount, 2);

                    if (color === 'black') {
                        assert.equal(blackCount, TESTING_SIZE * TESTING_SIZE - 2);
                        assert.equal(whiteCount, 0);
                    } else {
                        assert.equal(blackCount, 0);
                        assert.equal(whiteCount, TESTING_SIZE * TESTING_SIZE - 2);
                    }
                });

                return promise;
            });
        });
    });
});
