# Go Board Alexa Skill

This repo contains the code behind the Go Board Alexa Skill.

## Getting Started

Requires a system with nodejs, npm, and awscli. Tested on Cygwin (Windows 7) and MacOS for testing, and Amazon Linux (lambda).

To upload to Lambda, run `./upload.sh`. Ensure that aws credentials are located at `~/.aws/credentials` and config is at `~/.aws/config`.

To test locally, change the executable in the `src/config.js` file to:

- Cygwin - `tst/gnugo.exe`
- MacOS - `tst/gnugo_ios`
- Amazon Linux - `src/gnugo.exe` (named so it receives executable permissions when uploaded from Windows).

Enter the tst directory, and run `npm test`