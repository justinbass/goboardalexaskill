const config = require('./config');
const {execFile} = require('child_process');

const ASCII_ARGS = ['--mode', 'ascii'];

function getOtherColor(color) {
    if (color === 'black') {
        return 'white';
    } else if (color === 'white') {
        return 'black';
    }
}

// Get the prompt for accepting gnugo input, depending on your color
function getColorPromptRegex(color) {
    if (color === 'black') {
        return /black\(\d+\)/g;
    } else if (color === 'white') {
        return /white\(\d+\)/g;
    }
}

function getGameRulesArg(rules) {
    if (rules.toLowerCase() === 'chinese') {
        return '--chinese-rules';
    } else if (rules.toLowerCase() === 'japanese') {
        return '--japanese-rules';
    }
}

// Get args to pass into gnugo based on the gameoptions
function getOptionsArgs(gameOptions, inFilename) {
    // This clock time is a weak form of time restraint on the AI. Without it, the AI will take up to minutes to complete calculation on AWS Lambda.
    const CLOCK_TIME = '1.00s';

    let optionsArgs = [
        '--boardsize', gameOptions.boardSize,
        '--color', gameOptions.color,
        '--handicap', gameOptions.handicap,
        '--komi', gameOptions.komi,
        '--level', gameOptions.level,
        '--max-level', gameOptions.level,
        getGameRulesArg(gameOptions.rules),
        '--clock', CLOCK_TIME,
        '--autolevel',
        '--quiet'];

    if (inFilename !== null && inFilename !== undefined) {
        optionsArgs = optionsArgs.concat(['-l', inFilename]);
    }

    return optionsArgs;
}

function getPromptsCount(output, color) {
    return (output.match(getColorPromptRegex(color)) || []).length;
}

// Execute go commands, waiting up to 5s to complete.
// Run custom logic to write into the program, and ready out from it - somewhat like an Expect script.
// Callback function calls with output as the argument
function executeGoCommands(args, customLogic, callback) {
    const promise = new Promise((resolve) => {
        const execHandler = execFile(config.GNUGO_EXECUTABLE, args);
        const timeout = setTimeout(() => {
            execHandler.kill();
        }, config.GO_COMMAND_TIMEOUT_MILLIS);

        let output = '';

        execHandler.stdout.on('data', (data) => {
            // Append to the output. Note that this callback comes with unpredictably random sized chunks of the output, so we cannot trust it to
            // contain a string in the expect script. We should only use the full output for parsing.
            output += data.toString();

            if (customLogic !== null) {
                try {
                    customLogic(output, execHandler);
                } catch (error) {
                    console.log('GO EXECUTION EXCEPTION: ' + error);
                }
            }
        });

        // Do not react to STDERR. These unavoidable timeout logs are typically here:
        // clock: white   0min 1.00sec
        // clock: black   0min 1.00sec
        execHandler.stderr.on('data', (data) => {
            // console.log(`STDERR: ${data.toString()}`);
        });

        execHandler.on('exit', (code) => {
            clearTimeout(timeout);
            resolve(output);
        });
    });

    promise.then(callback);
}

function executeGetBoard(inFilename, gameOptions, callback) {
    const args = ASCII_ARGS.concat(getOptionsArgs(gameOptions, inFilename));

    let continueFlag = false;
    let quitFlag = false;
    function customLogic(output, execHandler) {
        // If we see "continue", as in the game is over by resignations, type it to display the board.
        if (!continueFlag && (output.match(/continue/g) || []).length > 0) {
            continueFlag = true;
            execHandler.stdin.write('continue\n');
        }

        // Quit on the first prompt
        if (!quitFlag && getPromptsCount(output, gameOptions.color) === 1) {
            quitFlag = true;
            execHandler.stdin.write('quit\n');
        }
    }

    executeGoCommands(args, customLogic, callback);
}

function executeInitializeBoard(outFilename, gameOptions, callback) {
    const args = ASCII_ARGS.concat(getOptionsArgs(gameOptions));

    // Make sure that each command only occurs exactly one time, to avoid unnecessarily flooding the executable with input. Required since the
    // customLogic function is called numerous times as the output buffer is being built up.
    let quitFlag = false;
    let saveFlag = false;

    function customLogic(output, execHandler) {
        // Save on the first prompt
        if (!saveFlag && getPromptsCount(output, gameOptions.color) === 1) {
            saveFlag = true;
            execHandler.stdin.write(`save ${outFilename}\n`);
        } else

        // Quit on the second prompt
        if (!quitFlag && getPromptsCount(output, gameOptions.color) === 2) {
            quitFlag = true;
            execHandler.stdin.write('quit\n');
        }
    }

    executeGoCommands(args, customLogic, callback);
}

// Arguments: playerMove: 'A1'. This is exactly what the user said, but GnuGo skips 'I' so we will increment the letter by one if it's I or greater.
// Expects a file at filename to be written before calling.
// Writes a file with the output SGF to filename.
// Calls callback function with output as an argument on completion.
//
// The number of boards in the output depends on the existing state and what moves are made by the player and AI.
// No boards: The game is already over.
// Board 1: The original board, before moves are made.
// Board 2: The board after the player's move is made, OR the board after the AI's move is made if the player passed. Not present if the player
//          resigns, or if the player passed and the AI resigns.
// Board 3: The board after the AI's move is made (not available if they resign or pass).
// Board 4: The board after the AI's move is made after saving (same as 3) (not available if they resign or pass).
function executePlayerCommand(playerMove, inFilename, gameOptions, callback) {
    const outFilename = inFilename;
    const firstCharVal = playerMove.slice(0, 1).charCodeAt(0);

    // Sanitize input
    if (playerMove.length > 3 ||
        firstCharVal < 'A'.charCodeAt(0) ||
        firstCharVal > 'Z'.charCodeAt() ||
        isNaN(playerMove.slice(1, 3))) {
        if (playerMove != 'pass' && playerMove != 'resign') {
            return;
        }
    }

    // If move is greater than I, add 1 to it. E.g. I1 -> J1, Q1 -> R1, A1 -> A1.
    if (firstCharVal >= 'I'.charCodeAt(0) &&
        firstCharVal <= 'Y'.charCodeAt()) {
        const horizontalLetter = String.fromCharCode(firstCharVal + 1);
        playerMove = horizontalLetter.concat(playerMove.slice(1, 3));
    }

    const args = ASCII_ARGS.concat(getOptionsArgs(gameOptions, inFilename));

    // Make sure that each command only occurs exactly one time, to avoid unnecessarily flooding the executable with input. Required since the
    // customLogic function is called numerous times as the output buffer is being built up.
    let moveFlag = false;
    let quitFlag = false;
    let saveFlag = false;

    function customLogic(output, execHandler, beforeSize) {
        // If we see an option to save, do so. Else if the output contains player's color [black(n)/white(n)] twice, this is the prompt meaning the
        // AI has made a move. Save after this too.
        if (!saveFlag && ((output.match(/to save/g) || []).length > 0 ||
            getPromptsCount(output, gameOptions.color) === 2)
        ) {
            saveFlag = true;
            execHandler.stdin.write(`save ${outFilename}\n`);
        } else

        // After saving, if we see an option to quit, do so. Else if the output contains player's color [black(n)/white(n)] thrice, this is the
        // prompt meaning the previous save has completed. Quit after this too.
        if (!quitFlag && ((output.match(/quit/g) || []).length > 0 ||
            getPromptsCount(output, gameOptions.color) === 3)
        ) {
            quitFlag = true;
            execHandler.stdin.write('quit\n');
        } else

        // If game is not over (no save/quit) and the AI hasn't made their move yet, wait for black(n)/white(n) to show exactly once, which is the
        // prompt for accepting a move.
        if (!moveFlag && getPromptsCount(output, gameOptions.color) === 1) {
            moveFlag = true;

            // Write the player's move
            execHandler.stdin.write(playerMove + '\n');
        }
    }

    executeGoCommands(args, customLogic, callback);
}

// Undo the last two moves (other player's first, then our player's).
function executeUndoMoves(inFilename, gameOptions, callback) {
    const outFilename = inFilename;
    const args = ASCII_ARGS.concat(getOptionsArgs(gameOptions, inFilename));

    // Make sure that each command only occurs exactly one time, to avoid unnecessarily flooding the executable with input. Required since the
    // customLogic function is called numerous times as the output buffer is being built up.
    let saveFlag = false;
    let quitFlag = false;
    let undoOtherPlayerFlag = false;
    let undoPlayerFlag = false;

    function customLogic(output, execHandler, beforeSize) {
        // If output contains player's color [black(n)/white(n)] twice, this is the prompt meaning the AI's move has also been undone. We need this
        // to occur before the resulting third board is written, and before we can save.
        if (!saveFlag && getPromptsCount(output, gameOptions.color) === 2) {
            saveFlag = true;

            execHandler.stdin.write(`save ${outFilename}\n`);
        } else

        // If output contains player's color [black(n)/white(n)] thrice, this means the board is saved and we can quit. A fourth board is written,
        // which we can effectively ignore.
        // If output contains other player's color [black(n)/white(n)] twice, this means the second undo was invalid, which happens when white
        // starts and undo is made as the first move. Quit immediately and don't save.
        if (!quitFlag && (getPromptsCount(output, gameOptions.color) === 3 ||
                          getPromptsCount(output, getOtherColor(gameOptions.color)) === 2)) {
            quitFlag = true;
            execHandler.stdin.write('quit\n');
        } else

        // Undo the other player's move first, if the prompt is for our next move.
        if (!undoOtherPlayerFlag && getPromptsCount(output, gameOptions.color) === 1) {
            undoOtherPlayerFlag = true;

            // Write the first undo (once only)
            execHandler.stdin.write('undo\n');
        } else

        // Undo our player's move next, if the prompt is for the other player's move.
        if (!undoPlayerFlag && getPromptsCount(output, getOtherColor(gameOptions.color)) === 1) {
            undoPlayerFlag = true;

            // Write the first undo (once only)
            execHandler.stdin.write('undo\n');
        }
    }

    executeGoCommands(args, customLogic, callback);
}

function executeGetScore(inFilename, callback) {
    let args = ['--score', 'estimate'];

    if (inFilename !== null) {
        args = args.concat(['-l', inFilename]);
    }

    executeGoCommands(args, null, callback);
}

function executePlayerMove(move, inFilename, gameOptions, callback) {
    executePlayerCommand(move, inFilename, gameOptions, callback);
}

function executePlayerPass(inFilename, gameOptions, callback) {
    executePlayerCommand('pass', inFilename, gameOptions, callback);
}

function executePlayerResign(inFilename, gameOptions, callback) {
    executePlayerCommand('resign', inFilename, gameOptions, callback);
}

module.exports = module.exports = {
    'executeInitializeBoard': executeInitializeBoard,
    'executeGetBoard': executeGetBoard,
    'executePlayerMove': executePlayerMove,
    'executePlayerPass': executePlayerPass,
    'executePlayerResign': executePlayerResign,
    'executeUndoMoves': executeUndoMoves,
    'executeGetScore': executeGetScore,
};
