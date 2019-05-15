const NATO_ALPHABET = {
    'A': 'Alfa',
    'B': 'Bravo',
    'C': 'Charlie',
    'D': 'Delta',
    'E': 'Echo',
    'F': 'Foxtrot',
    'G': 'Golf',
    'H': 'Hotel',
    'I': 'India',
    'J': 'Juliett',
    'K': 'Kilo',
    'L': 'Lima',
    'M': 'Mike',
    'N': 'November',
    'O': 'Oscar',
    'P': 'Papa',
    'Q': 'Quebec',
    'R': 'Romeo',
    'S': 'Sierra',
    'T': 'Tango',
    'U': 'Uniform',
    'V': 'Victor',
    'W': 'Whiskey',
    'X': 'Xray',
    'Y': 'Yankee',
    'Z': 'Zulu',
};

// NOTE: The script gnugo.exe is an Amazon Linux binary, not a Windows executable. On Windows, we cannot upload to lambda without a zip, and windows
//       doesn't mark files in a zip as executable unless the file extension is exe.
// const GNUGO_EXECUTABLE = './gnugo_ios';
const GNUGO_EXECUTABLE = './gnugo.exe';
const GO_COMMAND_TIMEOUT_MILLIS = 20000;

const DEFAULT_DISPLAY_TIME_MILLISECONDS = 30 * 1000; // Observed on Echo Show devices
const MAX_DISPLAY_TIME_MILLISECONDS = 5 * 60 * 1000;

const VALID_BOARD_SIZES = ['9', '11', '13', '15', '17', '19'];
const VALID_HANDICAPS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const VALID_LEVELS = ['1', '2', '3', '4', '5', '6'];
const VALID_RULES = ['chinese', 'japanese'];
const VALID_COLORS = ['white', 'black'];
const VALID_KOMIS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];

const DEFAULT_BOARD_SIZE = 17;
const DEFAULT_COLOR = 'black';
const DEFAULT_HANDICAP = 0;
const DEFAULT_KOMI = 6.5;
const DEFAULT_LEVEL = 1;
const DEFAULT_RULES = 'chinese';

const DEFAULT_GAME_OPTIONS = getGameOptions(DEFAULT_BOARD_SIZE, DEFAULT_COLOR, DEFAULT_HANDICAP, DEFAULT_KOMI, DEFAULT_LEVEL, DEFAULT_RULES);

function getGameOptions(boardSize, color, handicap, komi, level, rules) {
    return {
        'boardSize': boardSize,
        'color': color,
        'handicap': handicap,
        'komi': komi,
        'level': level,
        'rules': rules,
    };
}

module.exports = module.exports = {
    'DEFAULT_DISPLAY_TIME_MILLISECONDS': DEFAULT_DISPLAY_TIME_MILLISECONDS,
    'DEFAULT_GAME_OPTIONS': DEFAULT_GAME_OPTIONS,
    'GNUGO_EXECUTABLE': GNUGO_EXECUTABLE,
    'GO_COMMAND_TIMEOUT_MILLIS': GO_COMMAND_TIMEOUT_MILLIS,
    'MAX_DISPLAY_TIME_MILLISECONDS': MAX_DISPLAY_TIME_MILLISECONDS,
    'NATO_ALPHABET': NATO_ALPHABET,
    'VALID_BOARD_SIZES': VALID_BOARD_SIZES,
    'VALID_COLORS': VALID_COLORS,
    'VALID_HANDICAPS': VALID_HANDICAPS,
    'VALID_KOMIS': VALID_KOMIS,
    'VALID_LEVELS': VALID_LEVELS,
    'VALID_RULES': VALID_RULES,
    'getGameOptions': getGameOptions,
};
