# ThinQ CLI Login Helper

A standalone command-line tool for authenticating with LG ThinQ, saving your session, and listing discovered devices for use with the Matterbridge LG ThinQ plugin.

## Setup

Build the project first:

```bash
npm run build:local
```

This compiles TypeScript and generates the CLI binary at `dist/cli.js`.

## Usage

Run the CLI with:

```bash
npm run cli -- --command <command> [options]
```

## Commands

| Command   | Options                             | Description                                          |
| --------- | ----------------------------------- | ---------------------------------------------------- |
| `login`   | `--type`, `--country`, `--language` | Authenticate and save session                        |
| `devices` |                                     | List all discovered ThinQ devices (requires `login`) |
| `help`    |                                     | Show help message                                    |

## Login Command

The `login` command guides you through authentication and saves your credentials to a local session file.

### Options

- `--type`: Authentication method (default: `account`)
  - `account`: Username/password authentication
  - `token`: Refresh token authentication
- `--country`: Country code (default: `US`) — must match your LG ThinQ account region
- `--language`: Language code (default: `en-US`)
- `--debug`: Enable debug logging

### Examples

#### Account-based authentication (default):

```bash
npm run cli -- --command login
```

You will be prompted for:

- Username (email)
- Password

#### Account-based authentication with specific region:

```bash
npm run cli -- --command login --type account --country KR --language ko-KR
```

#### Token-based authentication:

```bash
npm run cli -- --command login --type token
```

You will be prompted for:

- Refresh token

### Example Session Output

```
Login successful. Session saved to .cli-session.json
Session Summary:
  Login Type: account
  Country: US
  Language: en-US
  Access Token: ****XXXX
  Refresh Token: ****XXXX
  Expires At: 2026-09-08T23:59:59.000Z
```

Note: All tokens are masked in the output for security.

## Devices Command

The `devices` command lists all ThinQ devices discovered in your account, using the session saved by a prior `login` command.

### Options

- `--debug`: Enable debug logging

### Prerequisites

You must run `--command login` successfully first. If no session file is found, the command prints an error and exits.

### Example

```bash
npm run cli -- --command devices
```

### Example Output

```
Found 2 device(s):

1. Living Room AC
   Device ID:     a1b2c3d4-e5f6-7890-abcd-ef1234567890
   Type:          AC
   Platform Type: thinq2
   Model Name:    RAC-1234
   Online:        true

2. Kitchen Fridge
   Device ID:     b2c3d4e5-f6a7-8901-bcde-f12345678901
   Type:          REFRIGERATOR
   Platform Type: thinq2
   Model Name:    LRF-5678
   Online:        false
```

## Session File

After successful login, your session is saved to `.cli-session.json` in your working directory:

```json
{
  "loginType": "account",
  "country": "US",
  "language": "en-US",
  "userData": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAtEpochSeconds": 1234567890,
    "country": "US",
    "language": "en-US"
  }
}
```

**⚠️ Important:** This file contains authentication credentials. Keep it secure and do NOT commit it to version control (it is in `.gitignore` by default).

## Notes

### Supported Authentication Methods

- **Account (username/password):** Uses LG's standard account login flow
- **Refresh token:** For previously-saved tokens; skips the full login chain

### Browser-Based SSO

Third-party SSO (Google, Apple, Facebook, Amazon) is not yet supported in this CLI tool. If your account uses only these methods, you will need to use the Matterbridge web UI or manually obtain a refresh token.

### Device Control

This CLI supports authentication (`login`) and device discovery/listing (`devices`). Device control is not yet available and is handled by the full Matterbridge runtime instead.

### Credentials Security

- Passwords are **never printed** to the console or stored anywhere (only the token is saved).
- All displayed tokens are automatically masked for security.
- Input credentials are read interactively via the terminal, not from command-line arguments, to avoid exposure in shell history.
